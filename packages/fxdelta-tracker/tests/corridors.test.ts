/**
 * SLICE-191-1: corridor registry sanity (D-191-7 — TVL ≥ $50k gate).
 * Data comes from the 191-0 Uniswap V3 pool inventory spike.
 */

import { describe, it, expect } from "vitest";
import {
  CORRIDORS,
  THIN_CORRIDORS,
  TVL_THRESHOLD_USD,
} from "../src/corridors.js";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

describe("corridors registry", () => {
  it("has ≥4 alertable corridors ≥ $50k TVL (191-0 AC)", () => {
    const ok = CORRIDORS.filter(
      (c) => !c.thin && (c.tvlUsdApprox ?? 0) >= TVL_THRESHOLD_USD,
    );
    expect(ok.length).toBeGreaterThanOrEqual(4);
  });

  it("every alertable corridor has a verified Uniswap pool + fiat code", () => {
    for (const c of CORRIDORS) {
      expect(ADDR_RE.test(c.token), `${c.symbol} token`).toBe(true);
      expect(c.fiat).toMatch(/^[A-Z]{3}$/);
      expect(c.uniswapPool, `${c.symbol} pool`).toBeDefined();
      expect(ADDR_RE.test(c.uniswapPool!.address)).toBe(true);
      expect([100, 500, 3000, 10000]).toContain(c.uniswapPool!.fee);
      expect(c.tvlUsdApprox).toBeGreaterThanOrEqual(TVL_THRESHOLD_USD);
      expect(c.thin ?? false).toBe(false);
    }
  });

  it("thin corridors never alert and never duplicate the alertable set", () => {
    const main = new Set(CORRIDORS.map((c) => c.symbol));
    for (const c of THIN_CORRIDORS) {
      expect(c.thin).toBe(true);
      expect(main.has(c.symbol), `${c.symbol} duplicated`).toBe(false);
      if (c.uniswapPool) {
        expect(ADDR_RE.test(c.uniswapPool.address)).toBe(true);
        expect(c.tvlUsdApprox ?? 0).toBeLessThan(TVL_THRESHOLD_USD);
      }
    }
  });

  it("no symbol or token address duplicates across registries", () => {
    const all = [...CORRIDORS, ...THIN_CORRIDORS];
    const syms = all.map((c) => c.symbol);
    const addrs = all.map((c) => c.token.toLowerCase());
    expect(new Set(syms).size).toBe(syms.length);
    expect(new Set(addrs).size).toBe(addrs.length);
  });

  it("LatAm track coverage: wARS alertable, wBRL/wCOP thin-tracked", () => {
    const bySymbol = new Map(
      [...CORRIDORS, ...THIN_CORRIDORS].map((c) => [c.symbol, c]),
    );
    expect(bySymbol.get("wARS")?.thin ?? false).toBe(false);
    for (const s of ["wBRL", "wCOP", "wMXN", "wPEN", "wCLP"]) {
      expect(bySymbol.get(s)?.thin, `${s} should be thin`).toBe(true);
    }
  });
});
