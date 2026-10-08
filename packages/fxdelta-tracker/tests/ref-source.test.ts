/**
 * SLICE-191-3: FxRefSource tests — cascade fallback, market phases, freeze.
 */

import { describe, it, expect } from "vitest";
import {
  FxRefSource,
  marketPhase,
  type Fetcher,
} from "../src/fx/ref-source.js";

const OPEN_TS = Date.UTC(2026, 9, 8, 12, 0, 0); // Thu 12:00 UTC
const WEEKEND_TS = Date.UTC(2026, 9, 10, 15, 0, 0); // Sat 15:00 UTC
const CLOSED_TS = Date.UTC(2026, 9, 8, 21, 30, 0); // Thu 21:30 UTC

function mkFetcher(
  router: Record<string, (u: string) => { status: number; body: unknown }>,
): Fetcher {
  return async (url) => {
    for (const [key, fn] of Object.entries(router)) {
      if (url.includes(key)) {
        const r = fn(url);
        return { status: r.status, json: async () => r.body };
      }
    }
    return { status: 404, json: async () => ({}) };
  };
}

describe("marketPhase", () => {
  it("Thu 12:00 → open", () => expect(marketPhase(OPEN_TS)).toBe("open"));
  it("Thu 21:30 → closed (daily break)", () =>
    expect(marketPhase(CLOSED_TS)).toBe("closed"));
  it("Fri 22:00 → weekend", () =>
    expect(marketPhase(Date.UTC(2026, 9, 9, 22, 0, 0))).toBe("weekend"));
  it("Sat → weekend", () => expect(marketPhase(WEEKEND_TS)).toBe("weekend"));
  it("Sun 10:00 → weekend, Sun 22:00 → open", () => {
    expect(marketPhase(Date.UTC(2026, 9, 11, 10, 0, 0))).toBe("weekend");
    expect(marketPhase(Date.UTC(2026, 9, 11, 22, 0, 0))).toBe("open");
  });
  it("Mon 05:00 → open", () =>
    expect(marketPhase(Date.UTC(2026, 9, 12, 5, 0, 0))).toBe("open"));
});

describe("FxRefSource cascade", () => {
  const brl = { status: 200, body: { value: [{ cotacaoVenda: 5.31 }] } };

  it("erapi hit wins first", async () => {
    const f = mkFetcher({
      "er-api.com": () => ({
        status: 200,
        body: { result: "success", rates: { BRL: 5.42, NGN: 1500 } },
      }),
    });
    const src = new FxRefSource({ fetcher: f, now: () => OPEN_TS });
    const prices = await src.pollOnce(["BRL", "NGN"]);
    expect(prices).toHaveLength(2);
    expect(prices[0]).toMatchObject({
      pair: "USD/BRL", rate: 5.42, provider: "erapi", phase: "open", frozen: false,
    });
  });

  it("erapi 429 → falls back to frankfurter", async () => {
    const f = mkFetcher({
      "er-api.com": () => ({ status: 429, body: {} }),
      "frankfurter.dev": () => ({ status: 200, body: { rates: { BRL: 5.3 } } }),
    });
    const src = new FxRefSource({ fetcher: f, now: () => OPEN_TS });
    const prices = await src.pollOnce(["BRL"]);
    expect(prices[0].provider).toBe("frankfurter");
    expect(prices[0].rate).toBe(5.3);
  });

  it("pair missing in frankfurter → next provider (bcptax for BRL)", async () => {
    const f = mkFetcher({
      "er-api.com": () => ({ status: 500, body: {} }),
      "frankfurter.dev": () => ({ status: 200, body: { rates: {} } }), // no BRL
      "olinda.bcb.gov.br": () => brl,
    });
    const src = new FxRefSource({ fetcher: f, now: () => OPEN_TS });
    const prices = await src.pollOnce(["BRL"]);
    expect(prices[0]).toMatchObject({ rate: 5.31, provider: "bcptax" });
  });

  it("all providers fail → no emission when cache empty", async () => {
    const f = mkFetcher({ "er-api.com": () => ({ status: 500, body: {} }) });
    const src = new FxRefSource({ fetcher: f, now: () => OPEN_TS });
    expect(await src.pollOnce(["NGN"])).toHaveLength(0);
  });

  it("all providers fail → stale cache emitted frozen", async () => {
    let fail = false;
    const f = mkFetcher({
      "er-api.com": () =>
        fail
          ? { status: 500, body: {} }
          : { status: 200, body: { result: "success", rates: { NGN: 1501 } } },
    });
    let t = OPEN_TS;
    const src = new FxRefSource({ fetcher: f, now: () => t });
    const first = await src.pollOnce(["NGN"]);
    expect(first[0].rate).toBe(1501);
    fail = true;
    t = OPEN_TS + 310_000; // past cache TTL (default 5min) → refetch fails
    const second = await src.pollOnce(["NGN"]);
    expect(second[0]).toMatchObject({ rate: 1501, frozen: true });
  });

  it("USD fiat → fixed 1.0 parity, no fetch", async () => {
    const src = new FxRefSource({
      fetcher: async () => ({ status: 500, json: async () => ({}) }),
      now: () => OPEN_TS,
    });
    const prices = await src.pollOnce(["USD"]);
    expect(prices[0]).toMatchObject({ pair: "USD/USD", rate: 1, provider: "fixed" });
  });
});

describe("FxRefSource freeze (D-191-6)", () => {
  it("closed/weekend emits last close frozen, does not refetch", async () => {
    let calls = 0;
    const f = mkFetcher({
      "er-api.com": () => {
        calls++;
        return {
          status: 200,
          body: { result: "success", rates: { ARS: 1600 + calls } },
        };
      },
    });
    let t = OPEN_TS;
    const src = new FxRefSource({ fetcher: f, now: () => t, ttlMs: 0 });
    const open = await src.pollOnce(["ARS"]);
    expect(open[0].frozen).toBe(false);
    const openRate = open[0].rate;

    t = WEEKEND_TS;
    const wk = await src.pollOnce(["ARS"]);
    // frozen → same rate, no new fetch
    expect(wk[0]).toMatchObject({
      rate: openRate, frozen: true, phase: "weekend", fetchedAtMs: open[0].fetchedAtMs,
    });
    const callsAfterWeekend = calls;
    await src.pollOnce(["ARS"]);
    expect(calls).toBe(callsAfterWeekend);

    t = CLOSED_TS;
    const cl = await src.pollOnce(["ARS"]);
    expect(cl[0].frozen).toBe(true);
    expect(cl[0].rate).toBe(openRate);
  });

  it("cold start inside weekend → fetch once, emit frozen", async () => {
    const f = mkFetcher({
      "er-api.com": () => ({
        status: 200,
        body: { result: "success", rates: { ARS: 1590 } },
      }),
    });
    const src = new FxRefSource({ fetcher: f, now: () => WEEKEND_TS });
    const prices = await src.pollOnce(["ARS"]);
    expect(prices[0]).toMatchObject({ rate: 1590, frozen: true, phase: "weekend" });
  });
});
