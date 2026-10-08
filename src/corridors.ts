/**
 * Corridor registry — DRAFT from SLICE-191-0 pool inventory (2026-10-08).
 *
 * TVL source: Uniswap V3 pools on Celo mainnet (factory
 * 0xAfE208a311B21f13EF87E33A90049fC17A7acDEc), quote-leg ×2 approximation.
 * Gate: TVL ≥ $50k (D-191-7). Borderline corridors get thin:true and do
 * not alert.
 *
 * NOTE: corridors whose liquidity lives on Textile RFQ or Mento FPMM
 * (wBRL/wCOP/wMXN/wPEN/wCLP, IDRX, BRLm/COPm…) show thin/no Uniswap pools —
 * their price source comes from 191-2 (FPMM / RFQ), not this table.
 * Re-run: bun scripts/pool-inventory.ts
 */

import type { Address } from "viem";

export const TVL_THRESHOLD_USD = 50_000;

export interface Corridor {
  /** Local stable symbol */
  symbol: string;
  /** Fiat currency code for FX-reference lookup (er-api/Frankfurter/PTAX) */
  fiat: string;
  /** Token contract on Celo mainnet */
  token: Address;
  decimals: number;
  /** Best Uniswap V3 pool (fee tier + address) found in spike, if any */
  uniswapPool?: { fee: number; address: Address; quoteSymbol: string };
  /** Approx pool TVL in USD at spike time */
  tvlUsdApprox?: number;
  /** Below threshold — monitored but never alerts (D-191-7) */
  thin?: boolean;
  /** Track relevance */
  tracks: ("latam" | "textile" | "usat")[];
}

const U = {
  USDT: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as Address,
  USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as Address,
  USDm: "0x765de816845861e75a25fca122bb6898b8b1282a" as Address,
};

/** Corridors ≥ $50k TVL on Uniswap V3 — the alerting set. */
export const CORRIDORS: Corridor[] = [
  {
    symbol: "cNGN", fiat: "NGN",
    token: "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f", decimals: 6,
    uniswapPool: { fee: 100, address: "0x6519d56Eb0A69FC0338657784c783B169b8f7d32", quoteSymbol: "USDT" },
    tvlUsdApprox: 197_110, tracks: ["textile"],
  },
  {
    symbol: "AUDm", fiat: "AUD",
    token: "0x7175504C455076F15c04A2F90a8e352281F492F9", decimals: 18,
    uniswapPool: { fee: 100, address: "0x59aBE068150BE95582479a405f2734cB533f9354", quoteSymbol: "USDT" },
    tvlUsdApprox: 197_808, tracks: [],
  },
  {
    symbol: "USAT", fiat: "USD",
    token: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771", decimals: 6,
    uniswapPool: { fee: 100, address: "0x070D575a713EaF5025462D0865Fb0Dac4B14bC38", quoteSymbol: "USDT" },
    tvlUsdApprox: 179_618, tracks: ["usat"],
  },
  {
    symbol: "NGNm", fiat: "NGN",
    token: "0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71", decimals: 18,
    uniswapPool: { fee: 100, address: "0x1e2F87e1f8056Fcd39695aAeb63cb475E1DD2318", quoteSymbol: "USDT" },
    tvlUsdApprox: 89_622, tracks: [],
  },
  {
    symbol: "wARS", fiat: "ARS",
    token: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", decimals: 18,
    uniswapPool: { fee: 100, address: "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391", quoteSymbol: "USDT" },
    tvlUsdApprox: 86_876, tracks: ["latam", "textile"],
  },
  {
    symbol: "GBPm", fiat: "GBP",
    token: "0xCCF663b1fF11028f0b19058d0f7B674004a40746", decimals: 18,
    uniswapPool: { fee: 100, address: "0xb1ea2E17C8aBCFA5Ba111c92A9a1ad8C5728153f", quoteSymbol: "USDT" },
    tvlUsdApprox: 58_763, tracks: [],
  },
];

/** Below-threshold or non-Uniswap corridors — tracked, never alert. */
export const THIN_CORRIDORS: Corridor[] = [
  { symbol: "BRLA", fiat: "BRL", token: "0xfecb3f7c54e2caae9dc6ac9060a822d47e053760", decimals: 18, uniswapPool: { fee: 100, address: "0x14E577e42d45Fd2200A9B0e31D87Fe826467111a", quoteSymbol: "USDT" }, tvlUsdApprox: 45_702, thin: true, tracks: ["latam"] },
  { symbol: "BRLm", fiat: "BRL", token: "0xe8537a3d056da446677b9e9d6c5db704eaab4787", decimals: 18, uniswapPool: { fee: 100, address: "0x1625fE58Cdb3726e5841Fb2bb367Dde9AAa009B3", quoteSymbol: "USDT" }, tvlUsdApprox: 42_848, thin: true, tracks: ["latam"] },
  { symbol: "COPM", fiat: "COP", token: "0xC92E8Fc2947E32F2B574CCA9F2F12097A71d5606", decimals: 18, uniswapPool: { fee: 100, address: "0x4495F525C4ECaCF9713a51eC3e8d1e81d7dFf870", quoteSymbol: "USDT" }, tvlUsdApprox: 33_237, thin: true, tracks: ["latam"] },
  { symbol: "wBRL", fiat: "BRL", token: "0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0", decimals: 18, uniswapPool: { fee: 100, address: "0x01c3cf91cdf7B34181C7eC8566c0236951FEA40F", quoteSymbol: "USDT" }, tvlUsdApprox: 21_665, thin: true, tracks: ["latam", "textile"] },
  { symbol: "GHSm", fiat: "GHS", token: "0xfAeA5F3404bbA20D3cc2f8C4B0A888F55a3c7313", decimals: 18, uniswapPool: { fee: 100, address: "0x6BAB3AfA6d0c42d539bcbc33Ffb68C0406913413", quoteSymbol: "USDT" }, tvlUsdApprox: 14_483, thin: true, tracks: [] },
  { symbol: "XOFm", fiat: "XOF", token: "0x73F93dcc49cB8A239e2032663e9475dd5ef29A08", decimals: 18, uniswapPool: { fee: 100, address: "0xAA97F0689660eA15b7d6f84F2E5250B63f2b381a", quoteSymbol: "USDm" }, tvlUsdApprox: 11_284, thin: true, tracks: [] },
  // No Uniswap pool found — liquidity on Textile RFQ / Mento FPMM only (191-2)
  { symbol: "wCOP", fiat: "COP", token: "0x8a1d45e102e886510e891d2ec656a708991e2d76", decimals: 18, thin: true, tracks: ["latam", "textile"] },
  { symbol: "wMXN", fiat: "MXN", token: "0x337e7456b420bd3481e7fa61fa9850343d610d34", decimals: 18, thin: true, tracks: ["latam"] },
  { symbol: "wPEN", fiat: "PEN", token: "0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE", decimals: 18, thin: true, tracks: ["latam"] },
  { symbol: "wCLP", fiat: "CLP", token: "0x61D450a098b6a7f69fC4b98CE68198fe59768651", decimals: 18, thin: true, tracks: ["latam"] },
  { symbol: "IDRX", fiat: "IDR", token: "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22", decimals: 2, thin: true, tracks: ["textile"] },
  { symbol: "COPm", fiat: "COP", token: "0x8a567e2ae79ca692bd748ab832081c45de4041ea", decimals: 18, thin: true, tracks: ["latam"] },
  { symbol: "EURm", fiat: "EUR", token: "0xd8763cba276a3738e6de85b4b3bf5fded6d6ca73", decimals: 18, thin: true, tracks: [] },
  { symbol: "KESm", fiat: "KES", token: "0x456a3D042C0DbD3db53D5489e98dFb038553B0d0", decimals: 18, thin: true, tracks: [] },
  { symbol: "JPYm", fiat: "JPY", token: "0xc45eCF20f3CD864B32D9794d6f76814aE8892e20", decimals: 18, thin: true, tracks: [] },
  { symbol: "CHFm", fiat: "CHF", token: "0xb55a79F398E759E43C95b979163f30eC87Ee131D", decimals: 18, thin: true, tracks: [] },
];

export const QUOTE_TOKENS = U;
