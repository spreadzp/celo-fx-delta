/**
 * SLICE-191-2 live smoke (AC#2): one poll tick on Celo mainnet.
 *
 * Checks:
 *  - USDC/USDm FPMM oracle rate ≈ 1.0 ±0.5% (peg sanity).
 *  - Corridor implied rates ≈ real FX (reference table below).
 *  - oracleLag attached when a corridor has both legs.
 *
 * Run: bun scripts/smoke-celo-prices.ts
 */

import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import {
  CeloPriceSource,
  MENTO,
  type CorridorPrice,
} from "../packages/fxdelta-tracker/src/celo/price-source.ts";

const client = createPublicClient({
  chain: celo,
  transport: http(process.env.CELO_RPC_URL || "https://forno.celo.org"),
});

// --- AC#2a: USDC/USDm FPMM pool ≈ 1.0 ---------------------------------------
const FPMM_USDC_USDM = "0x462fe04b4FD719Cbd04C0310365D421D02AaA19E";
const st = (await client.readContract({
  address: FPMM_USDC_USDM,
  abi: [
    {
      name: "getRebalancingState",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bool" },
        { type: "uint16" },
        { type: "uint256" },
      ],
    },
  ],
  functionName: "getRebalancingState",
})) as readonly [bigint, bigint, bigint, bigint, boolean, number, bigint];
const usdcRate = Number(st[0]) / Number(st[1]);
console.log(
  `USDC/USDm FPMM oracle rate = ${usdcRate.toFixed(6)} ${
    Math.abs(usdcRate - 1) < 0.005 ? "PASS ±0.5%" : "FAIL"
  }`,
);

// --- Corridor tick -----------------------------------------------------------
const src = new CeloPriceSource({ rpcUrl: "", client });
const seen: CorridorPrice[] = [];
src.start([], (p) => {
  seen.push(p);
  const lag =
    p.oracleLag !== undefined ? ` lag=${(p.oracleLag * 100).toFixed(3)}%` : "";
  console.log(
    `${p.source.padEnd(7)} ${p.corridor.padEnd(12)} rate=${p.price.toFixed(6)} tvl=$${p.tvlUsd.toFixed(0)} thin=${p.thin}${lag}`,
  );
});
await new Promise((r) => setTimeout(r, 15_000));
src.stop();

// --- AC#2b: implied rates ≈ real FX (±5% band, Oct 2026 refs) ----------------
const EXPECTED: Record<string, number> = {
  "wARS/USDT": 1600, "BRLm/USDT": 5.4, "BRLA/USDT": 5.4, "wBRL/USDT": 5.4,
  "COPM/USDT": 3900, "cNGN/USDT": 1500, "NGNm/USDT": 1500, "USAT/USDT": 1.0,
  "AUDm/USDT": 1.55, "GBPm/USDT": 0.76, "GHSm/USDT": 11.5, "XOFm/USDm": 580,
};
let pass = 0,
  fail = 0;
for (const [corridor, ref] of Object.entries(EXPECTED)) {
  const p = seen.find((x) => x.corridor === corridor && x.source === "uniswap");
  if (!p) {
    console.log(`${corridor}: no price`);
    fail++;
    continue;
  }
  const dev = Math.abs(p.price - ref) / ref;
  const ok = dev < 0.05;
  console.log(
    `${corridor}: ${p.price.toFixed(4)} vs ~${ref} dev=${(dev * 100).toFixed(1)}% ${ok ? "PASS" : "CHECK"}`,
  );
  ok ? pass++ : fail++;
}
console.log(`\nFX checks: ${pass} pass, ${fail} check | legs uni=${seen.filter(p=>p.source==="uniswap").length} mento=${seen.filter(p=>p.source==="mento").length} | oracleLag emitted: ${seen.filter(p=>p.oracleLag!==undefined).length}`);
