/**
 * CeloPriceSource — onchain price legs per corridor (EPIC-191, SLICE-191-2, D-191-4).
 *
 * Two independent legs per corridor where liquidity exists:
 *  - "uniswap": Uniswap V3 pool — slot0 sqrtPriceX96 → implied rate,
 *    balanceOf legs → TVL estimate (quote leg × 2, as in the 191-0 spike).
 *  - "mento":   Mento V3 FPMM pool — getRebalancingState() returns the
 *    oracle rate, reserve-implied rate and their deviation in one call.
 *    Pools are resolved at runtime via FPMMFactory.getPool(local, USDm).
 *
 * When both legs exist in the same poll tick the emitted prices carry
 * `oracleLag = |uniswap − mento| / mento` — the metric nobody else has.
 *
 * Thin rule (D-191-7): corridor.thin OR live quote-leg TVL < $50k →
 * thin: true on the emitted price (monitored, never alerts).
 *
 * RPC failures → exponential backoff (pollMs × 2^k, cap 60s), aligned
 * with the bstock WS reconnect pattern.
 */

import { createPublicClient, http, type Address } from "viem";
import { celo } from "viem/chains";
import {
  CORRIDORS,
  THIN_CORRIDORS,
  QUOTE_TOKENS,
  TVL_THRESHOLD_USD,
  type Corridor,
} from "../corridors.js";

// ---------------------------------------------------------------------------
// Chain constants (Celo mainnet, 42220)
// ---------------------------------------------------------------------------

export const MENTO = {
  /** Mento V3 FPMMFactory — getPool(token0, token1), tokens sorted. */
  fpmmFactory: "0xa849b475FE5a4B5C9C3280152c7a1945b907613b" as Address,
  /** Mento USDm — the quote leg of every FPMM corridor pair. */
  usdm: QUOTE_TOKENS.USDm,
} as const;

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;

const UNISWAP_V3_POOL_ABI = [
  {
    name: "token0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "token1",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const FPMM_FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
    ],
    outputs: [{ type: "address" }],
  },
] as const;

const FPMM_POOL_ABI = [
  {
    name: "getRebalancingState",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "oraclePriceNumerator", type: "uint256" },
      { name: "oraclePriceDenominator", type: "uint256" },
      { name: "reservePriceNumerator", type: "uint256" },
      { name: "reservePriceDenominator", type: "uint256" },
      { name: "reservePriceAboveOraclePrice", type: "bool" },
      { name: "rebalanceThreshold", type: "uint16" },
      { name: "priceDifference", type: "uint256" },
    ],
  },
  {
    name: "token0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "invertRateFeed",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

/** Quote token decimals on Celo mainnet. */
const QUOTE_DECIMALS: Record<string, number> = {
  USDT: 6,
  USDC: 6,
  USDm: 18,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorridorPrice {
  /** Corridor label, e.g. "wARS/USDT" or "GBPm/USDm". */
  corridor: string;
  /** Local stable symbol, e.g. "wARS". */
  symbol: string;
  /** Implied FX rate: local units per 1 USD (e.g. ~5.4 for BRL). */
  price: number;
  /** Inverse: USD per 1 local unit. */
  usdPrice: number;
  /** Which leg produced this price. */
  source: "uniswap" | "mento";
  /** Pool TVL estimate in USD (uniswap leg) or 0 (mento leg). */
  tvlUsd: number;
  /** Below TVL gate or marked thin in the registry (D-191-7). */
  thin: boolean;
  /** |otherLeg − thisLeg| / thisLeg when both legs sampled in one tick. */
  oracleLag?: number;
  /** Observation timestamp. */
  tsMs: number;
}

export type OnCorridorPrice = (p: CorridorPrice) => void;

/** Minimal read surface — viem PublicClient satisfies this structurally. */
export interface MulticallClient {
  multicall(args: {
    contracts: readonly unknown[];
    allowFailure?: boolean;
  }): Promise<readonly { status: string; result?: unknown }[]>;
}

export interface CeloPriceSourceOptions {
  rpcUrl: string;
  chainId?: number;
  /** Poll interval — default 5000 (Celo ~1s blocks; D-191-4). */
  pollMs?: number;
  corridors?: readonly Corridor[];
  /** Injectable client for tests — defaults to viem http client. */
  client?: MulticallClient;
}

// ---------------------------------------------------------------------------
// Pure math helpers (exported for tests)
// ---------------------------------------------------------------------------

const Q192 = 2n ** 192n;

/**
 * Uniswap V3 human price: units of token1 per 1 token0.
 * raw = (sqrtPX96 / 2^96)^2; human = raw × 10^(dec0−dec1).
 */
export function sqrtPriceToRate(
  sqrtPriceX96: bigint,
  dec0: number,
  dec1: number,
): number {
  if (sqrtPriceX96 <= 0n) return NaN;
  // Number() after bigint square keeps ~15 significant digits — fine
  // for monitoring.
  const num = Number(sqrtPriceX96 * sqrtPriceX96) * 10 ** dec0;
  const den = Number(Q192) * 10 ** dec1;
  return num / den;
}

/**
 * Implied corridor rate (local units per 1 USD) for a local/quote pool.
 * If token0 = local, token1 = quote(USD): t1PerT0 = USD per local → invert.
 * If token0 = quote(USD), token1 = local: t1PerT0 = local per USD → as is.
 */
export function impliedRateLocalPerUsd(
  token1PerToken0: number,
  token0IsLocal: boolean,
): number {
  if (!Number.isFinite(token1PerToken0) || token1PerToken0 <= 0) return NaN;
  return token0IsLocal ? 1 / token1PerToken0 : token1PerToken0;
}

/** |a − b| / b — undefined when denominator is invalid. */
export function oracleLag(a: number, b: number): number | undefined {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return undefined;
  return Math.abs(a - b) / b;
}

/** Exponential backoff: pollMs × 2^k, capped at 60s. */
export function backoffMs(pollMs: number, failures: number): number {
  const capped = Math.min(failures, 6);
  return Math.min(pollMs * 2 ** capped, 60_000);
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export class CeloPriceSource {
  readonly name = "celo-onchain";
  private readonly client: MulticallClient;
  private readonly pollMs: number;
  private readonly corridors: readonly Corridor[];
  private running = false;
  private ok = false;
  private timer?: ReturnType<typeof setTimeout>;
  private onPrice?: OnCorridorPrice;

  constructor(opts: CeloPriceSourceOptions) {
    this.pollMs = opts.pollMs ?? 5_000;
    this.corridors = opts.corridors ?? [...CORRIDORS, ...THIN_CORRIDORS];
    this.client =
      opts.client ??
      (createPublicClient({
        chain: {
          ...celo,
          id: opts.chainId ?? 42220,
          contracts: {
            ...celo.contracts,
            multicall3: { address: MULTICALL3 },
          },
        },
        transport: http(opts.rpcUrl),
      }) as unknown as MulticallClient);
  }

  get connected(): boolean {
    return this.running && this.ok;
  }

  /** PriceSource-style signature: symbols filter corridor symbols. */
  start(symbols: readonly string[], onPrice: OnCorridorPrice): void {
    if (this.running) return;
    this.running = true;
    this.onPrice = onPrice;
    const wanted =
      symbols.length > 0
        ? this.corridors.filter((c) => symbols.includes(c.symbol))
        : this.corridors;
    void this.loop(wanted);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(targets: readonly Corridor[]): Promise<void> {
    let failures = 0;
    // Resolve Mento FPMM pools once (stable deployments).
    const mentoPools = await this.resolveMentoPools(targets);
    while (this.running) {
      try {
        const prices = await this.pollOnce(targets, mentoPools);
        failures = 0;
        this.ok = true;
        for (const p of prices) this.onPrice?.(p);
      } catch {
        this.ok = false;
        failures += 1;
      }
      if (!this.running) break;
      const wait =
        failures === 0 ? this.pollMs : backoffMs(this.pollMs, failures);
      await new Promise<void>((r) => {
        this.timer = setTimeout(r, wait);
      });
    }
  }

  private async resolveMentoPools(
    targets: readonly Corridor[],
  ): Promise<Map<string, Address>> {
    const usdm = MENTO.usdm;
    const calls = targets.map((c) => {
      const [t0, t1] =
        c.token.toLowerCase() < usdm.toLowerCase()
          ? ([c.token, usdm] as const)
          : ([usdm, c.token] as const);
      return {
        address: MENTO.fpmmFactory,
        abi: FPMM_FACTORY_ABI,
        functionName: "getPool",
        args: [t0, t1],
      } as const;
    });
    const out = new Map<string, Address>();
    try {
      const res = await this.client.multicall({
        contracts: calls,
        allowFailure: true,
      });
      res.forEach((r, i) => {
        const pool = r.result as Address | undefined;
        if (
          r.status === "success" &&
          pool &&
          pool.toLowerCase() !== ZERO_ADDRESS
        ) {
          out.set(targets[i].symbol, pool);
        }
      });
    } catch {
      // Factory unreachable — mento leg disabled this run.
    }
    return out;
  }

  private async pollOnce(
    targets: readonly Corridor[],
    mentoPools: Map<string, Address>,
  ): Promise<CorridorPrice[]> {
    const tsMs = Date.now();
    const uni = targets.filter((c) => c.uniswapPool);
    const mento = targets.filter((c) => mentoPools.has(c.symbol));

    // Uniswap leg: token0, token1, slot0, balanceOf(local), balanceOf(quote).
    const uniCalls = uni.flatMap((c) => {
      const pool = c.uniswapPool!.address;
      const quoteAddr =
        QUOTE_TOKENS[c.uniswapPool!.quoteSymbol as keyof typeof QUOTE_TOKENS];
      return [
        { address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: "token0" },
        { address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: "token1" },
        { address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: "slot0" },
        {
          address: c.token,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [pool],
        },
        {
          address: quoteAddr,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [pool],
        },
      ] as const;
    });

    // Mento leg: getRebalancingState + token0 (orientation).
    const mentoCalls = mento.flatMap((c) => {
      const pool = mentoPools.get(c.symbol)!;
      return [
        {
          address: pool,
          abi: FPMM_POOL_ABI,
          functionName: "getRebalancingState",
        },
        { address: pool, abi: FPMM_POOL_ABI, functionName: "token0" },
      ] as const;
    });

    const [uniRes, mentoRes] = await Promise.all([
      uniCalls.length
        ? this.client.multicall({ contracts: uniCalls, allowFailure: true })
        : Promise.resolve([] as { status: string; result?: unknown }[]),
      mentoCalls.length
        ? this.client.multicall({ contracts: mentoCalls, allowFailure: true })
        : Promise.resolve([] as { status: string; result?: unknown }[]),
    ]);

    const prices: CorridorPrice[] = [];
    const uniRate = new Map<string, number>();
    const mentoRate = new Map<string, number>();

    uni.forEach((c, i) => {
      const base = i * 5;
      const token0 = uniRes[base]?.result as Address | undefined;
      const slot0 = uniRes[base + 2]?.result as
        | readonly [bigint, number, number, number, number, number, boolean]
        | undefined;
      const balQuote = uniRes[base + 4]?.result as bigint | undefined;
      if (!token0 || !slot0 || balQuote === undefined) return;
      const quoteSym = c.uniswapPool!.quoteSymbol;
      const qDec = QUOTE_DECIMALS[quoteSym] ?? 18;
      const token0IsLocal =
        token0.toLowerCase() === c.token.toLowerCase();
      const dec0 = token0IsLocal ? c.decimals : qDec;
      const dec1 = token0IsLocal ? qDec : c.decimals;
      const rate = impliedRateLocalPerUsd(
        sqrtPriceToRate(slot0[0], dec0, dec1),
        token0IsLocal,
      );
      if (!Number.isFinite(rate)) return;
      const tvlUsd = (Number(balQuote) / 10 ** qDec) * 2;
      uniRate.set(c.symbol, rate);
      prices.push({
        corridor: `${c.symbol}/${quoteSym}`,
        symbol: c.symbol,
        price: rate,
        usdPrice: 1 / rate,
        source: "uniswap",
        tvlUsd,
        thin: c.thin === true || tvlUsd < TVL_THRESHOLD_USD,
        tsMs,
      });
    });

    mento.forEach((c, i) => {
      const base = i * 2;
      const st = mentoRes[base]?.result as
        | readonly [bigint, bigint, bigint, bigint, boolean, number, bigint]
        | undefined;
      const token0 = mentoRes[base + 1]?.result as Address | undefined;
      if (!st || !token0) return;
      const [oracleNum, oracleDen] = st;
      if (oracleDen === 0n || oracleNum === 0n) return;
      // FPMM oracle num/den is the pool-quote rate for token0→token1
      // (verified onchain on USDm/USDC ≈ 1.0). Orient to local-per-USD:
      // local is always paired with USDm (≈$1).
      const token0IsLocal = token0.toLowerCase() === c.token.toLowerCase();
      const oracleRate = Number(oracleNum) / Number(oracleDen);
      const rate = token0IsLocal ? 1 / oracleRate : oracleRate;
      if (!Number.isFinite(rate) || rate <= 0) return;
      mentoRate.set(c.symbol, rate);
      prices.push({
        corridor: `${c.symbol}/USDm`,
        symbol: c.symbol,
        price: rate,
        usdPrice: 1 / rate,
        source: "mento",
        tvlUsd: 0, // FPMM reserves are not the corridor liquidity gate
        thin: c.thin === true,
        tsMs,
      });
    });

    // oracleLag: both legs sampled this tick → attach to each emitted price.
    for (const p of prices) {
      const other = p.source === "uniswap" ? mentoRate : uniRate;
      const lag = oracleLag(other.get(p.symbol) ?? NaN, p.price);
      if (lag !== undefined) p.oracleLag = lag;
    }
    return prices;
  }
}
