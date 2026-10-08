/**
 * fxdelta-tracker — FX-delta engine for Celo local stablecoins (EPIC-191).
 *
 * Public barrel. Slices add: Celo price source (191-2), FX reference
 * cascade (191-3), DeltaEngine port (191-4), x402 self-settle (191-6).
 */

export {
  loadFxDeltaConfig,
  getFxDeltaConfig,
  resetFxDeltaConfigCache,
} from "./env.js";
export type {
  CeloConfig,
  FxConfig,
  FxDeltaConfig,
  FxProviderId,
  PostgresConfig,
  SelfSettleConfig,
  TelegramConfig,
  X402Config,
  X402Mode,
} from "./env.js";

export { CORRIDORS, QUOTE_TOKENS, THIN_CORRIDORS, TVL_THRESHOLD_USD } from "./corridors.js";
export type { Corridor } from "./corridors.js";

export {
  CeloPriceSource,
  MENTO,
  sqrtPriceToRate,
  impliedRateLocalPerUsd,
  oracleLag,
  backoffMs,
} from "./celo/price-source.js";
export type {
  CeloPriceSourceOptions,
  CorridorPrice,
  OnCorridorPrice,
} from "./celo/price-source.js";

export { FxRefSource, marketPhase } from "./fx/ref-source.js";
export type {
  FxRefPrice,
  FxRefSourceOptions,
  MarketPhase,
  OnFxPrice,
} from "./fx/ref-source.js";

export { DeltaEngine } from "./engine/delta-engine.js";
export type {
  DeltaAlert,
  DeltaEngineOptions,
  DeltaEvent,
  DeltaSnapshot,
  DeltaView,
  HistoryPoint,
} from "./engine/delta-engine.js";
