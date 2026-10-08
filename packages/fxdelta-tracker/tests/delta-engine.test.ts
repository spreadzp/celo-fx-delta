/**
 * SLICE-191-4: DeltaEngine port tests — hysteresis, phases, staleness,
 * thin-suppression, frozen flag, oracleLag (D-191-4/6/7).
 * Adapted from bstock delta-engine.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeltaEngine } from "../src/engine/delta-engine.js";
import type { Corridor } from "../src/corridors.js";
import type { CorridorPrice } from "../src/celo/price-source.js";
import type { FxRefPrice } from "../src/fx/ref-source.js";

const CORRIDORS: Corridor[] = [
  {
    symbol: "wARS", fiat: "ARS",
    token: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d",
    decimals: 18, tracks: ["latam"],
  },
  {
    symbol: "BRLm", fiat: "BRL",
    token: "0xe8537a3d056da446677b9e9d6c5db704eaab4787",
    decimals: 18, tracks: ["latam"], thin: true,
  },
];

let now = 1_000_000;
const advance = (ms: number) => {
  now += ms;
};

function chainPrice(
  symbol: string,
  price: number,
  over: Partial<CorridorPrice> = {},
): CorridorPrice {
  return {
    corridor: `${symbol}/USDT`,
    symbol,
    price,
    usdPrice: 1 / price,
    source: "uniswap",
    tvlUsd: 100_000,
    thin: false,
    tsMs: now,
    ...over,
  };
}

function fxRef(
  fiat: string,
  rate: number,
  over: Partial<FxRefPrice> = {},
): FxRefPrice {
  return {
    pair: `USD/${fiat}`,
    fiat,
    rate,
    provider: "erapi",
    phase: "open",
    frozen: false,
    fetchedAtMs: now,
    tsMs: now,
    ...over,
  };
}

function makeEngine(thresholdPct = 0.5) {
  const onAlert = vi.fn();
  const engine = new DeltaEngine({ thresholdPct, now: () => now, onAlert });
  engine.setCorridors(CORRIDORS);
  return { engine, onAlert };
}

beforeEach(() => {
  now = 1_000_000;
});

describe("delta calculation", () => {
  it("deltaPct = (chain − fxRef)/fxRef × 100", () => {
    const { engine } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));
    engine.onChainPrice(chainPrice("wARS", 1520));
    const d = engine.getView("wARS")!;
    // (1520 − 1500)/1500 × 100 ≈ 1.333%
    expect(d.deltaPct).toBeCloseTo(1.333, 3);
    expect(d.stale).toBe(false);
    expect(d.phase).toBe("open");
    expect(d.frozen).toBe(false);
  });

  it("deltaPct null until both legs present", () => {
    const { engine } = makeEngine();
    engine.onChainPrice(chainPrice("wARS", 1520));
    expect(engine.getView("wARS")!.deltaPct).toBeNull();
  });

  it("ignores non-positive ticks (venue-closed zeros)", () => {
    const { engine } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));
    engine.onChainPrice(chainPrice("wARS", 1520));
    engine.onChainPrice(chainPrice("wARS", 0));
    engine.onFxRef(fxRef("ARS", 0));
    const d = engine.getView("wARS")!;
    expect(d.chainRate).toBe(1520);
    expect(d.fxRefRate).toBe(1500);
  });
});

describe("hysteresis + threshold", () => {
  it("alerts on crossing 0.5%, no repeat while above, re-arms below", () => {
    const { engine, onAlert } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));

    engine.onChainPrice(chainPrice("wARS", 1510)); // +0.67% → alert
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert.mock.calls[0]![0]).toMatchObject({
      corridor: "wARS", fiat: "ARS", phase: "open",
    });

    engine.onChainPrice(chainPrice("wARS", 1520)); // still above → none
    expect(onAlert).toHaveBeenCalledTimes(1);

    engine.onChainPrice(chainPrice("wARS", 1502)); // re-arm
    engine.onChainPrice(chainPrice("wARS", 1512)); // cross again → alert
    expect(onAlert).toHaveBeenCalledTimes(2);
  });

  it("negative delta crossing also alerts", () => {
    const { engine, onAlert } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));
    engine.onChainPrice(chainPrice("wARS", 1490)); // −0.67%
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert.mock.calls[0]![0].deltaPct).toBeLessThan(0);
  });
});

describe("market phases", () => {
  it("outside open: second alert within 3h suppressed, allowed after", () => {
    const { engine, onAlert } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500, { phase: "closed" }));

    engine.onChainPrice(chainPrice("wARS", 1510));
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert.mock.calls[0]![0].phase).toBe("closed");

    advance(3_600_000);
    engine.onChainPrice(chainPrice("wARS", 1501));
    engine.onChainPrice(chainPrice("wARS", 1511));
    expect(onAlert).toHaveBeenCalledTimes(1); // suppressed <3h

    advance(2 * 3_600_000 + 1);
    engine.onChainPrice(chainPrice("wARS", 1501));
    engine.onChainPrice(chainPrice("wARS", 1511));
    expect(onAlert).toHaveBeenCalledTimes(2);
  });

  it("open phase has no cooldown", () => {
    const { engine, onAlert } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));
    for (let i = 0; i < 3; i++) {
      engine.onChainPrice(chainPrice("wARS", 1510));
      engine.onChainPrice(chainPrice("wARS", 1501));
    }
    expect(onAlert).toHaveBeenCalledTimes(3);
  });

  it("weekend phase tags the alert", () => {
    const { engine, onAlert } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500, { phase: "weekend", frozen: true }));
    engine.onChainPrice(chainPrice("wARS", 1520));
    expect(onAlert.mock.calls[0]![0]).toMatchObject({
      phase: "weekend", frozen: true,
    });
  });
});

describe("staleness", () => {
  it("no onchain tick >15s → stale:true, fresh tick can alert", () => {
    const { engine, onAlert } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));
    engine.onChainPrice(chainPrice("wARS", 1501));
    expect(engine.getView("wARS")!.stale).toBe(false);

    advance(16_000);
    expect(engine.getView("wARS")!.stale).toBe(true);

    engine.onChainPrice(chainPrice("wARS", 1515));
    expect(onAlert).toHaveBeenCalledTimes(1);
  });
});

describe("thin corridors (D-191-7)", () => {
  it("thin corridor tracked in view but never alerts", () => {
    const { engine, onAlert } = makeEngine();
    engine.onFxRef(fxRef("BRL", 5.0));
    engine.onChainPrice(chainPrice("BRLm", 5.5)); // +10% — huge
    expect(onAlert).not.toHaveBeenCalled();
    const v = engine.getView("BRLm")!;
    expect(v.deltaPct).toBeCloseTo(10, 0);
    expect(v.thin).toBe(true);
    expect(v.inAlert).toBe(false);
  });

  it("live thin flag from price tick also suppresses", () => {
    const { engine, onAlert } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));
    engine.onChainPrice(chainPrice("wARS", 1520, { thin: true, tvlUsd: 20_000 }));
    expect(onAlert).not.toHaveBeenCalled();
    expect(engine.getView("wARS")!.thin).toBe(true);
  });
});

describe("frozen fxRef (D-191-6)", () => {
  it("frozen flag surfaces in view; frozen does NOT suppress alerts", () => {
    const { engine, onAlert } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500, { phase: "weekend", frozen: true }));
    engine.onChainPrice(chainPrice("wARS", 1520));
    const v = engine.getView("wARS")!;
    expect(v.frozen).toBe(true);
    expect(v.phase).toBe("weekend");
    expect(onAlert).toHaveBeenCalledTimes(1); // weekend delta IS the signal
  });
});

describe("oracleLag (D-191-4)", () => {
  it("computes when both uniswap and mento legs exist", () => {
    const { engine } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));
    engine.onChainPrice(chainPrice("wARS", 1520));
    engine.onChainPrice(
      chainPrice("wARS", 1525, { source: "mento", corridor: "wARS/USDm" }),
    );
    const v = engine.getView("wARS")!;
    expect(v.oracleLagPct).toBeCloseTo(Math.abs(1520 - 1525) / 1525, 6);
    expect(v.chainRate).toBe(1520); // uniswap leg drives delta
  });

  it("null without mento leg", () => {
    const { engine } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));
    engine.onChainPrice(chainPrice("wARS", 1520));
    expect(engine.getView("wARS")!.oracleLagPct).toBeNull();
  });
});

describe("events + digest + window", () => {
  it("events buffer capped, digest excludes thin and sorts by |delta|", () => {
    const { engine } = makeEngine();
    engine.pushEvent({ type: "pool/paused", corridor: "wARS", msg: "x" });
    expect(engine.getEvents()).toHaveLength(1);

    engine.onFxRef(fxRef("ARS", 1500));
    engine.onFxRef(fxRef("BRL", 5.0));
    engine.onChainPrice(chainPrice("wARS", 1520)); // +1.33%
    engine.onChainPrice(chainPrice("BRLm", 5.5));  // +10% but thin
    const digest = engine.getDigest();
    expect(digest).toHaveLength(1);
    expect(digest[0]!.corridor).toBe("wARS");
  });

  it("history keeps ≤1 pt/min", () => {
    const { engine } = makeEngine();
    engine.onFxRef(fxRef("ARS", 1500));
    now = 1_020_000;
    for (let i = 0; i < 10; i++) {
      engine.onChainPrice(chainPrice("wARS", 1500 + i));
      advance(10_000);
    }
    expect(engine.getHistory("wARS").length).toBeLessThanOrEqual(2);
    for (let i = 0; i < 5; i++) {
      advance(60_000);
      engine.onChainPrice(chainPrice("wARS", 1510));
    }
    expect(engine.getHistory("wARS").length).toBeGreaterThanOrEqual(5);
  });
});
