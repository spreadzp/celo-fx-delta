/**
 * SLICE-191-2: CeloPriceSource unit tests — pure math + fake multicall.
 */

import { describe, it, expect } from "vitest";
import {
  CeloPriceSource,
  sqrtPriceToRate,
  impliedRateLocalPerUsd,
  oracleLag,
  backoffMs,
  type CorridorPrice,
} from "../src/celo/price-source.js";
import type { Corridor } from "../src/corridors.js";
import type { Address } from "viem";

// --- pure math ---------------------------------------------------------------

describe("sqrtPriceToRate", () => {
  it("sqrtP = 2^97 → rate 4.0 (equal decimals)", () => {
    expect(sqrtPriceToRate(2n ** 97n, 18, 18)).toBeCloseTo(4, 12);
  });

  it("sqrtP = 2^96 → rate 1.0", () => {
    expect(sqrtPriceToRate(2n ** 96n, 6, 6)).toBe(1);
  });

  it("respects decimals: dec0=6 dec1=18 → ×10^-12", () => {
    // rate=4 raw → human = 4 × 10^(6−18)
    expect(sqrtPriceToRate(2n ** 97n, 6, 18)).toBeCloseTo(4e-12, 24);
  });

  it("zero/negative → NaN", () => {
    expect(Number.isNaN(sqrtPriceToRate(0n, 18, 18))).toBe(true);
  });
});

describe("impliedRateLocalPerUsd", () => {
  it("token0=quote → rate as-is (local per USD)", () => {
    expect(impliedRateLocalPerUsd(5.4, false)).toBe(5.4);
  });
  it("token0=local → inverted", () => {
    expect(impliedRateLocalPerUsd(0.185, true)).toBeCloseTo(1 / 0.185, 9);
  });
  it("invalid → NaN", () => {
    expect(Number.isNaN(impliedRateLocalPerUsd(0, false))).toBe(true);
    expect(Number.isNaN(impliedRateLocalPerUsd(-2, true))).toBe(true);
  });
});

describe("oracleLag", () => {
  it("relative deviation", () => {
    expect(oracleLag(5.5, 5.4)).toBeCloseTo(0.1 / 5.4, 9);
  });
  it("undefined on bad denominator", () => {
    expect(oracleLag(1, 0)).toBeUndefined();
    expect(oracleLag(1, NaN)).toBeUndefined();
  });
});

describe("backoffMs", () => {
  it("doubles per failure, caps at 60s", () => {
    expect(backoffMs(5_000, 0)).toBe(5_000);
    expect(backoffMs(5_000, 1)).toBe(10_000);
    expect(backoffMs(5_000, 2)).toBe(20_000);
    expect(backoffMs(5_000, 10)).toBe(60_000);
  });
});

// --- fake multicall integration ----------------------------------------------

const LOCAL = "0x00000000000000000000000000000000000000aa" as Address;
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as Address;
const POOL = "0x0000000000000000000000000000000000000b01" as Address;
const FPMM = "0x0000000000000000000000000000000000000f01" as Address;

function corridor(over: Partial<Corridor> = {}): Corridor {
  return {
    symbol: "tLOC",
    fiat: "XXX",
    token: LOCAL,
    decimals: 18,
    uniswapPool: { fee: 100, address: POOL, quoteSymbol: "USDT" },
    tracks: [],
    ...over,
  };
}

type Call = {
  address: Address;
  abi: readonly { name: string }[];
  functionName: string;
  args?: readonly unknown[];
};

/** sqrtP for human rate r (equal-decimals pool: dec0=18 local? see below). */
function sqrtFor(rateToken1PerToken0: number, dec0: number, dec1: number) {
  const raw = rateToken1PerToken0 * 10 ** (dec1 - dec0);
  return BigInt(Math.round(Math.sqrt(raw) * Number(2n ** 96n)));
}

function fakeClient(handlers: {
  uniswap: { rate: number; quoteBal: bigint };
  mento?: { oracleRate: number };
}) {
  return {
    multicall: async ({
      contracts,
    }: {
      contracts: readonly Call[];
      allowFailure?: boolean;
    }) => {
      return contracts.map((c) => {
        const fn = c.functionName;
        if (fn === "getPool") {
          return handlers.mento
            ? { status: "success", result: FPMM }
            : { status: "success", result: "0x0000000000000000000000000000000000000000" };
        }
        if (c.address === POOL) {
          if (fn === "token0")
            // USDT < LOCAL → token0 = quote
            return { status: "success", result: USDT };
          if (fn === "token1")
            return { status: "success", result: LOCAL };
          if (fn === "slot0") {
            const sqrt = sqrtFor(handlers.uniswap.rate, 6, 18);
            return {
              status: "success",
              result: [sqrt, 0, 0, 1, 1, 0, true] as const,
            };
          }
        }
        if (fn === "balanceOf") {
          const bal =
            c.address === USDT ? handlers.uniswap.quoteBal : 0n;
          return { status: "success", result: bal };
        }
        if (fn === "getRebalancingState" && handlers.mento) {
          const num = BigInt(Math.round(handlers.mento.oracleRate * 1e18));
          return {
            status: "success",
            // oracleNum, oracleDen, reserveNum, reserveDen, above, thr, diff
            result: [num, 10n ** 18n, num, 10n ** 18n, false, 50, 0n] as const,
          };
        }
        if (fn === "token0" && c.address === FPMM) {
          // FPMM token0: whichever sorted first — set local as token1 so
          // rate = oracleNum/oracleDen is local-per-USD path (token0IsLocal=false)
          return { status: "success", result: "0x765de816845861e75a25fca122bb6898b8b1282a" };
        }
        return { status: "failure", error: new Error("unmocked") };
      });
    },
    readContract: async () => {
      throw new Error("unused");
    },
  } as never;
}

async function collect(
  handlers: Parameters<typeof fakeClient>[0],
  c: Corridor[] = [corridor()],
): Promise<CorridorPrice[]> {
  const src = new CeloPriceSource({
    rpcUrl: "",
    pollMs: 10,
    corridors: c,
    client: fakeClient(handlers) as never,
  });
  const out: CorridorPrice[] = [];
  src.start([], (p) => out.push(p));
  await new Promise((r) => setTimeout(r, 400));
  src.stop();
  return out;
}

describe("CeloPriceSource (fake multicall)", () => {
  it("emits uniswap leg with implied rate + TVL", async () => {
    const prices = await collect({
      uniswap: { rate: 5.4, quoteBal: 100_000n * 10n ** 6n },
    });
    const uni = prices.filter((p) => p.source === "uniswap");
    expect(uni.length).toBeGreaterThan(0);
    expect(uni[0].corridor).toBe("tLOC/USDT");
    // USDT < LOCAL → token0=quote, rate is local-per-USD as-is
    expect(uni[0].price).toBeCloseTo(5.4, 2);
    expect(uni[0].usdPrice).toBeCloseTo(1 / 5.4, 3);
    expect(uni[0].tvlUsd).toBeCloseTo(200_000, 0); // quote×2
    expect(uni[0].thin).toBe(false);
  });

  it("thin flag at the $50k boundary (D-191-7)", async () => {
    const below = await collect({
      uniswap: { rate: 5.4, quoteBal: 24_999n * 10n ** 6n }, // $50k−2 TVL
    });
    expect(below.find((p) => p.source === "uniswap")!.thin).toBe(true);

    const at = await collect({
      uniswap: { rate: 5.4, quoteBal: 25_000n * 10n ** 6n }, // exactly $50k
    });
    expect(at.find((p) => p.source === "uniswap")!.thin).toBe(false);

    const forced = await collect(
      { uniswap: { rate: 5.4, quoteBal: 1_000_000n * 10n ** 6n } },
      [corridor({ thin: true })],
    );
    expect(forced.find((p) => p.source === "uniswap")!.thin).toBe(true);
  });

  it("emits mento leg + oracleLag when both legs exist", async () => {
    const prices = await collect({
      uniswap: { rate: 5.5, quoteBal: 100_000n * 10n ** 6n },
      mento: { oracleRate: 5.4 },
    });
    const mento = prices.find((p) => p.source === "mento");
    expect(mento).toBeDefined();
    expect(mento!.corridor).toBe("tLOC/USDm");
    expect(mento!.price).toBeCloseTo(5.4, 3);
    const uni = prices.find((p) => p.source === "uniswap");
    expect(uni!.oracleLag).toBeCloseTo(Math.abs(5.5 - 5.4) / 5.5, 4);
    expect(mento!.oracleLag).toBeCloseTo(Math.abs(5.5 - 5.4) / 5.4, 4);
  });

  it("symbols filter restricts to requested corridors", async () => {
    const c2 = corridor({ symbol: "tOTH" });
    const prices = await collect(
      {
        uniswap: { rate: 5.4, quoteBal: 100_000n * 10n ** 6n },
      },
      [corridor(), c2],
    );
    expect(prices.every((p) => p.symbol === "tLOC" || p.symbol === "tOTH")).toBe(
      true,
    );
  });
});
