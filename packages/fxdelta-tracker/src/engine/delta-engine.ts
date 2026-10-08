/**
 * DeltaEngine — in-memory core of the FX-delta tracker
 * (EPIC-191, SLICE-191-4). No DB, zero IO — sources are injected.
 *
 * Port of bstock delta-engine (EPIC-141) to fiat corridors:
 *   deltaPct = (onchain − fxRef) / fxRef × 100
 * where onchain = implied local-per-USD (CorridorPrice.price) and
 * fxRef = official local-per-USD (FxRefPrice.rate). Same units →
 * multiplier dropped (all stablecoins are 1:1 vs their fiat).
 *
 * Preserved invariants from 141:
 * - Threshold + hysteresis: alert on crossing |delta| ≥ thresholdPct,
 *   re-arm when it drops back below.
 * - Staleness: no onchain tick > staleMs → stale:true, stale never
 *   alerts (D15 analogue).
 * - Phase tags: open/closed/weekend ride on every alert and view;
 *   outside "open" max 1 alert per nonOpenCooldownMs (Q7 analogue).
 * - 24h rolling window, ≤1 pt/min per corridor (RAM-bound).
 * - Events buffer (pool/pair events), capped.
 *
 * New vs 141:
 * - thin corridors (D-191-7): tracked and shown, alerts suppressed.
 * - oracleLagPct (D-191-4): uniswap-vs-mento divergence per corridor.
 * - frozen (D-191-6): fxRef in last-close freeze. Frozen does NOT
 *   suppress alerts — weekend divergence IS the product signal.
 */

import type { CorridorPrice } from "../celo/price-source.js";
import type { FxRefPrice, MarketPhase } from "../fx/ref-source.js";
import type { Corridor } from "../corridors.js";

export interface DeltaAlert {
  corridor: string;
  fiat: string;
  deltaPct: number;
  /** Onchain implied rate (local per USD). */
  chainRate: number;
  /** Official rate (local per USD). */
  fxRefRate: number;
  phase: MarketPhase | "";
  frozen: boolean;
  oracleLagPct?: number;
  atMs: number;
}

export interface DeltaEvent {
  type: string;
  corridor: string;
  msg?: string;
  atMs: number;
}

export interface DeltaView {
  corridor: string;
  fiat: string;
  chainRate: number | null;
  fxRefRate: number | null;
  deltaPct: number | null;
  phase: MarketPhase | "";
  frozen: boolean;
  stale: boolean;
  thin: boolean;
  inAlert: boolean;
  oracleLagPct: number | null;
  tvlUsd: number;
  lastUpdateMs: number;
}

export interface HistoryPoint {
  t: number;
  deltaPct: number;
}

export interface DeltaSnapshot {
  corridors: DeltaView[];
  events: DeltaEvent[];
  atMs: number;
}

export interface DeltaEngineOptions {
  /** Alert threshold |delta%| (default 0.5, env DELTA_THRESHOLD_PCT). */
  thresholdPct?: number;
  /** No onchain tick longer than this → stale (default 15s — D15). */
  staleMs?: number;
  /** Min interval between alerts outside phase "open" (default 3h). */
  nonOpenCooldownMs?: number;
  /** History retention (default 24h). */
  historyWindowMs?: number;
  /** History granularity — ≤1 point per bucket (default 60s). */
  historyBucketMs?: number;
  /** Event buffer cap (default 500). */
  maxEvents?: number;
  now?: () => number;
  onAlert?: (alert: DeltaAlert) => void;
}

interface CorridorState {
  corridor: string;
  fiat: string;
  thin: boolean;
  chainRate: number | null;
  mentoRate: number | null;
  fxRefRate: number | null;
  deltaPct: number | null;
  phase: MarketPhase | "";
  frozen: boolean;
  tvlUsd: number;
  lastChainMs: number;
  lastRefMs: number;
  lastAlertAt: number | null;
  inAlert: boolean;
  history: HistoryPoint[];
}

const DEFAULTS = {
  thresholdPct: 0.5,
  staleMs: 15_000,
  nonOpenCooldownMs: 3 * 3_600_000,
  historyWindowMs: 24 * 3_600_000,
  historyBucketMs: 60_000,
  maxEvents: 500,
} as const;

export class DeltaEngine {
  private readonly thresholdPct: number;
  private readonly staleMs: number;
  private readonly nonOpenCooldownMs: number;
  private readonly historyWindowMs: number;
  private readonly historyBucketMs: number;
  private readonly maxEvents: number;
  private readonly now: () => number;
  private readonly onAlert?: (alert: DeltaAlert) => void;

  private readonly states = new Map<string, CorridorState>();
  private readonly events: DeltaEvent[] = [];

  constructor(options: DeltaEngineOptions = {}) {
    this.thresholdPct = options.thresholdPct ?? DEFAULTS.thresholdPct;
    this.staleMs = options.staleMs ?? DEFAULTS.staleMs;
    this.nonOpenCooldownMs =
      options.nonOpenCooldownMs ?? DEFAULTS.nonOpenCooldownMs;
    this.historyWindowMs = options.historyWindowMs ?? DEFAULTS.historyWindowMs;
    this.historyBucketMs = options.historyBucketMs ?? DEFAULTS.historyBucketMs;
    this.maxEvents = options.maxEvents ?? DEFAULTS.maxEvents;
    this.now = options.now ?? Date.now;
    this.onAlert = options.onAlert;
  }

  /** Register corridor registry entries. */
  setCorridors(corridors: readonly Corridor[]): void {
    for (const c of corridors) {
      const existing = this.states.get(c.symbol);
      if (existing) {
        existing.thin = c.thin === true;
        existing.fiat = c.fiat;
      } else {
        this.states.set(c.symbol, {
          corridor: c.symbol,
          fiat: c.fiat,
          thin: c.thin === true,
          chainRate: null,
          mentoRate: null,
          fxRefRate: null,
          deltaPct: null,
          phase: "",
          frozen: false,
          tvlUsd: 0,
          lastChainMs: 0,
          lastRefMs: 0,
          lastAlertAt: null,
          inAlert: false,
          history: [],
        });
      }
    }
  }

  /** Onchain tick (CeloPriceSource). Uniswap leg drives delta; mento leg
   *  updates oracleLag only — FPMM quote is a reference, not the market. */
  onChainPrice(p: CorridorPrice): void {
    const s = this.states.get(p.symbol);
    if (!s || !Number.isFinite(p.price) || p.price <= 0) return;
    if (p.source === "mento") {
      // Mento quote is a reference leg, not the market — it feeds
      // oracleLagPct in the view but never drives delta or staleness.
      s.mentoRate = p.price;
      return;
    }
    s.chainRate = p.price;
    s.tvlUsd = p.tvlUsd;
    s.thin = s.thin || p.thin;
    s.lastChainMs = this.now();
    this.recompute(s);
  }

  /** FX reference tick (FxRefSource). Frozen ticks keep phase/flag
   *  but the rate is the same last close — safe to store. */
  onFxRef(p: FxRefPrice): void {
    if (!Number.isFinite(p.rate) || p.rate <= 0) return;
    for (const s of this.states.values()) {
      if (s.fiat !== p.fiat) continue;
      s.fxRefRate = p.rate;
      s.phase = p.phase;
      s.frozen = p.frozen;
      s.lastRefMs = this.now();
      this.recompute(s);
    }
  }

  /** Pool/pair event → buffer. */
  pushEvent(e: Omit<DeltaEvent, "atMs">): void {
    this.events.push({ ...e, atMs: this.now() });
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  getView(corridor: string): DeltaView | null {
    const s = this.states.get(corridor);
    return s ? this.toView(s) : null;
  }

  /** All corridors; thin included (data visible, alerts gated). */
  getAll(): DeltaView[] {
    return [...this.states.values()].map((s) => this.toView(s));
  }

  /** Digest = non-thin corridors sorted by |delta| desc. */
  getDigest(): DeltaView[] {
    return this.getAll()
      .filter((v) => !v.thin && v.deltaPct !== null)
      .sort((a, b) => Math.abs(b.deltaPct!) - Math.abs(a.deltaPct!));
  }

  getEvents(): DeltaEvent[] {
    return [...this.events];
  }

  getHistory(corridor: string): HistoryPoint[] {
    return [...(this.states.get(corridor)?.history ?? [])];
  }

  getSnapshot(): DeltaSnapshot {
    return {
      corridors: this.getAll(),
      events: this.getEvents(),
      atMs: this.now(),
    };
  }

  // -------------------------------------------------------------------

  private recompute(s: CorridorState): void {
    if (s.chainRate === null || s.fxRefRate === null) {
      s.deltaPct = null;
      return;
    }
    if (s.fxRefRate === 0) {
      s.deltaPct = null;
      return;
    }
    s.deltaPct = ((s.chainRate - s.fxRefRate) / s.fxRefRate) * 100;
    this.recordHistory(s);
    this.checkAlert(s);
  }

  private checkAlert(s: CorridorState): void {
    const delta = s.deltaPct;
    if (delta === null) return;
    // Thin corridor — monitored, never alerts (D-191-7).
    if (s.thin) {
      s.inAlert = false;
      return;
    }
    // Stale onchain tick — no alerts off dead data (D15 analogue).
    if (this.now() - s.lastChainMs > this.staleMs) {
      s.inAlert = false;
      return;
    }
    if (Math.abs(delta) < this.thresholdPct) {
      s.inAlert = false; // re-arm
      return;
    }
    if (s.inAlert) return; // hysteresis
    // Phase cooldown: outside "open" max 1 alert per nonOpenCooldownMs.
    if (
      s.phase !== "open" &&
      s.lastAlertAt !== null &&
      this.now() - s.lastAlertAt < this.nonOpenCooldownMs
    ) {
      return;
    }
    s.inAlert = true;
    s.lastAlertAt = this.now();
    const view = this.toView(s);
    this.onAlert?.({
      corridor: s.corridor,
      fiat: s.fiat,
      deltaPct: delta,
      chainRate: s.chainRate!,
      fxRefRate: s.fxRefRate!,
      phase: s.phase,
      frozen: s.frozen,
      oracleLagPct: view.oracleLagPct ?? undefined,
      atMs: this.now(),
    });
  }

  private recordHistory(s: CorridorState): void {
    if (s.deltaPct === null) return;
    const t = this.now();
    const bucket = Math.floor(t / this.historyBucketMs);
    const last = s.history[s.history.length - 1];
    if (last && Math.floor(last.t / this.historyBucketMs) === bucket) {
      last.t = t;
      last.deltaPct = s.deltaPct;
    } else {
      s.history.push({ t, deltaPct: s.deltaPct });
    }
    const cutoff = t - this.historyWindowMs;
    while (s.history.length > 0 && s.history[0]!.t < cutoff) {
      s.history.shift();
    }
  }

  private toView(s: CorridorState): DeltaView {
    return {
      corridor: s.corridor,
      fiat: s.fiat,
      chainRate: s.chainRate,
      fxRefRate: s.fxRefRate,
      deltaPct: s.deltaPct,
      phase: s.phase,
      frozen: s.frozen,
      stale:
        s.lastChainMs === 0 || this.now() - s.lastChainMs > this.staleMs,
      thin: s.thin,
      inAlert: s.inAlert,
      oracleLagPct:
        s.chainRate !== null && s.mentoRate !== null && s.mentoRate > 0
          ? Math.abs(s.chainRate - s.mentoRate) / s.mentoRate
          : null,
      tvlUsd: s.tvlUsd,
      lastUpdateMs: Math.max(s.lastChainMs, s.lastRefMs),
    };
  }
}
