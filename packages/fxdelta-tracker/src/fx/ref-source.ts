/**
 * FxRefSource — offchain leg: official FX rates per corridor fiat
 * (EPIC-191, SLICE-191-3, D-191-5/D-191-6).
 *
 * Cascade (per-pair fallback):
 *   erapi     https://open.er-api.com/v6/latest/USD — broad free coverage
 *   frankfurter https://api.frankfurter.dev/v1/latest — ECB fiat set only
 *   bcptax    BCB PTAX OData — BRL only, weekday-only fixings
 * (finnhub = env-reserved, not wired — needs API key)
 *
 * Market phases (simplified UTC, D-191-6): FX closes Fri 21:00 UTC →
 * Sun 21:00 UTC plus daily 21:00–22:00 UTC break. In closed/weekend the
 * reference is the last observed close — emitted with frozen:true, so the
 * weekend on-chain/offchain divergence ("blue dollar" case) is the signal.
 * Holidays are v2.
 *
 * Rate semantics match CorridorPrice.price: local units per 1 USD.
 */

export type FxProviderId = "erapi" | "frankfurter" | "bcptax" | "finnhub";
export type MarketPhase = "open" | "closed" | "weekend";

export interface FxRefPrice {
  /** e.g. "USD/BRL" */
  pair: string;
  /** Fiat code, e.g. "BRL" */
  fiat: string;
  /** Local units per 1 USD. */
  rate: number;
  /** Provider that produced the rate ("fixed" for USD↔USD). */
  provider: FxProviderId | "fixed";
  /** Current FX market phase. */
  phase: MarketPhase;
  /** true when emitting last-close in closed/weekend phase. */
  frozen: boolean;
  /** Provider fetch time (not the emit time when frozen). */
  fetchedAtMs: number;
  tsMs: number;
}

export type OnFxPrice = (p: FxRefPrice) => void;

export type Fetcher = (
  url: string,
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface FxRefSourceOptions {
  /** Ordered cascade (D-191-5). Default erapi→frankfurter→bcptax. */
  providers?: FxProviderId[];
  /** Poll/cache TTL — clamped to ≥60s for free-tier limits. */
  ttlMs?: number;
  /** Injectable fetch for tests. */
  fetcher?: Fetcher;
  /** Injectable clock for tests. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Market phase (pure, exported for tests)
// ---------------------------------------------------------------------------

/**
 * Simplified FX week: open Sun 21:00 UTC → Fri 21:00 UTC with a daily
 * 21:00–22:00 UTC break. weekend = Fri≥21:00 … Sun<21:00.
 */
export function marketPhase(tsMs: number): MarketPhase {
  const d = new Date(tsMs);
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const hour = d.getUTCHours();
  if (
    (day === 5 && hour >= 21) ||
    day === 6 ||
    (day === 0 && hour < 21)
  ) {
    return "weekend";
  }
  if (hour === 21) return "closed";
  return "open";
}

// ---------------------------------------------------------------------------
// Provider fetchers — return { fiat → units-per-USD } or undefined
// ---------------------------------------------------------------------------

type RatesMap = Record<string, number>;
type ProviderFetch = (fiats: readonly string[], f: Fetcher) => Promise<RatesMap | undefined>;

const ERAPI_URL = "https://open.er-api.com/v6/latest/USD";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";
const PTAX_URL =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia";

/** Frankfurter (ECB) covers ~30 fiat currencies — not ARS/COP/NGN/KES/XOF/GHS/CLP/PEN. */
async function fetchErapi(fiats: readonly string[], f: Fetcher): Promise<RatesMap | undefined> {
  const res = await f(ERAPI_URL);
  if (res.status !== 200) return undefined;
  const body = (await res.json()) as { result?: string; rates?: RatesMap };
  if (body.result !== "success" || !body.rates) return undefined;
  return body.rates;
}

async function fetchFrankfurter(
  fiats: readonly string[],
  f: Fetcher,
): Promise<RatesMap | undefined> {
  const url = `${FRANKFURTER_URL}?base=USD&symbols=${fiats.join(",")}`;
  const res = await f(url);
  if (res.status !== 200) return undefined;
  const body = (await res.json()) as { rates?: RatesMap };
  return body.rates;
}

/** BCB PTAX — BRL/USD cotacaoVenda; empty on non-business days → walk back. */
async function fetchBcptax(fiats: readonly string[], f: Fetcher, now: () => number): Promise<RatesMap | undefined> {
  if (!fiats.includes("BRL")) return undefined;
  for (let back = 0; back < 5; back++) {
    const d = new Date(now() - back * 86_400_000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const url =
      `${PTAX_URL}(dataCotacao=@d)?@d='${mm}-${dd}-${d.getUTCFullYear()}'` +
      `&$top=1&$orderby=dataHoraCotacao desc&$format=json`;
    const res = await f(url);
    if (res.status !== 200) return undefined;
    const body = (await res.json()) as { value?: { cotacaoVenda?: number }[] };
    const rate = body.value?.[0]?.cotacaoVenda;
    if (rate) return { BRL: rate };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

interface CacheEntry {
  rate: number;
  provider: FxProviderId | "fixed";
  fetchedAtMs: number;
}

export class FxRefSource {
  readonly name = "fx-reference";
  private readonly providers: FxProviderId[];
  private readonly pollMs: number;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private running = false;
  private ok = false;
  private timer?: ReturnType<typeof setTimeout>;
  private onPrice?: OnFxPrice;

  constructor(opts: FxRefSourceOptions = {}) {
    this.providers = opts.providers ?? ["erapi", "frankfurter", "bcptax"];
    this.pollMs = Math.max(opts.ttlMs ?? 300_000, 60_000);
    this.fetcher =
      opts.fetcher ??
      (async (url) => {
        const res = await fetch(url);
        return { status: res.status, json: () => res.json() };
      });
    this.now = opts.now ?? Date.now;
  }

  get connected(): boolean {
    return this.running && this.ok;
  }

  /** fiats = fiat codes to track (corridor.fiat); USD emits fixed 1.0. */
  start(fiats: readonly string[], onPrice: OnFxPrice): void {
    if (this.running) return;
    this.running = true;
    this.onPrice = onPrice;
    const wanted = [...new Set(fiats.map((x) => x.toUpperCase()))];
    void this.loop(wanted);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(fiats: readonly string[]): Promise<void> {
    let failures = 0;
    while (this.running) {
      try {
        const prices = await this.pollOnce(fiats);
        failures = 0;
        this.ok = true;
        for (const p of prices) this.onPrice?.(p);
      } catch {
        this.ok = false;
        failures += 1;
      }
      if (!this.running) break;
      const wait = failures === 0 ? this.pollMs : Math.min(this.pollMs * 2 ** Math.min(failures, 6), 15 * 60_000);
      await new Promise<void>((r) => {
        this.timer = setTimeout(r, wait);
      });
    }
  }

  /** Exported for tests — one poll tick. */
  async pollOnce(fiats: readonly string[]): Promise<FxRefPrice[]> {
    const tsMs = this.now();
    const phase = marketPhase(tsMs);
    const frozen = phase !== "open";
    const out: FxRefPrice[] = [];

    for (const fiat of fiats) {
      // USD↔USD is fixed parity.
      if (fiat === "USD") {
        out.push({
          pair: "USD/USD", fiat, rate: 1, provider: "fixed",
          phase, frozen, fetchedAtMs: tsMs, tsMs,
        });
        continue;
      }

      const cached = this.cache.get(fiat);
      // Frozen market → emit last close, never refetch (D-191-6);
      // exception: cold start inside closed phase → fetch once, freeze it.
      if (frozen && cached) {
        out.push(this.emit(fiat, cached, phase, true, tsMs));
        continue;
      }
      if (!frozen && cached && tsMs - cached.fetchedAtMs < this.pollMs) {
        out.push(this.emit(fiat, cached, phase, false, tsMs));
        continue;
      }

      // Cascade: first provider returning the pair wins.
      let hit: CacheEntry | undefined;
      for (const pid of this.providers) {
        const rates = await this.fetchProvider(pid, fiats);
        if (!rates || !Number.isFinite(rates[fiat]) || rates[fiat] <= 0) {
          continue; // pair missing or provider error → next
        }
        hit = { rate: rates[fiat], provider: pid, fetchedAtMs: tsMs };
        break;
      }
      if (hit) {
        this.cache.set(fiat, hit);
        out.push(this.emit(fiat, hit, phase, frozen, tsMs));
      } else if (cached) {
        // All providers failed → emit stale cache (frozen so consumers know).
        out.push(this.emit(fiat, cached, phase, true, tsMs));
      }
      // no provider, no cache → pair unresolvable, emit nothing
    }
    return out;
  }

  private emit(
    fiat: string,
    e: CacheEntry,
    phase: MarketPhase,
    frozen: boolean,
    tsMs: number,
  ): FxRefPrice {
    return {
      pair: `USD/${fiat}`,
      fiat,
      rate: e.rate,
      provider: e.provider,
      phase,
      frozen,
      fetchedAtMs: e.fetchedAtMs,
      tsMs,
    };
  }

  private async fetchProvider(
    pid: FxProviderId,
    fiats: readonly string[],
  ): Promise<RatesMap | undefined> {
    try {
      switch (pid) {
        case "erapi":
          return await fetchErapi(fiats, this.fetcher);
        case "frankfurter":
          return await fetchFrankfurter(fiats, this.fetcher);
        case "bcptax":
          return await fetchBcptax(fiats, this.fetcher, this.now);
        default:
          return undefined; // finnhub — env-reserved, not wired
      }
    } catch {
      return undefined;
    }
  }
}
