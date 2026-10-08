/**
 * fxdelta-tracker env config (EPIC-191, SLICE-191-1).
 *
 * Pattern ported from @agentbadge/bstock-tracker env.ts:
 * optional sections + gating + error accumulation — one Error listing
 * every problem, not fail-fast on the first.
 *
 * Required:
 *   ATTRIBUTION_CODE            ERC-8021 tag (loops.house enrollment)
 * Optional sections:
 *   celo        CELO_RPC_URL (default forno), CELO_CHAIN_ID (default 42220)
 *   selfSettle  SELLER_PRIVATE_KEY — required when X402_MODE=self (D-191-1)
 *   x402        X402_MODE (self|facilitator, default self),
 *               X402_FACILITATOR_URL, X402_PRICE_USD (default 0.005)
 *   fx          FX_PROVIDERS (csv, default erapi,frankfurter,bcptax),
 *               FX_TTL_MS (default 5 min)
 *   postgres    DATABASE_URL (absent = in-memory + WARN, D-191-14)
 *   telegram    TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (both or neither)
 */

export interface CeloConfig {
  rpcUrl: string;
  chainId: number;
  /** Onchain poll interval (D-191-4); default 5s — Celo has ~1s blocks. */
  pollMs: number;
}

export interface SelfSettleConfig {
  /** 0x-prefixed 32-byte hex key of the wallet that submits tagged txs. */
  privateKey: `0x${string}`;
  /** Derived/set seller address — receives payments, sends tagged txs. */
  sellerAddress?: `0x${string}`;
}

export type X402Mode = "self" | "facilitator";

export interface X402Config {
  /** self = we submit transferWithAuthorization with our ERC-8021 tag
   *  (D-191-1 — required for leaderboard attribution). facilitator =
   *  api.x402.celo.org env-fallback. */
  mode: X402Mode;
  facilitatorUrl: string;
  /** Pay-per-request price in USD (D-191-8, default $0.005). */
  priceUsd: number;
}

export type FxProviderId = "erapi" | "frankfurter" | "bcptax" | "finnhub";

export interface FxConfig {
  /** Ordered cascade (D-191-5): erapi → frankfurter → bcptax. */
  providers: FxProviderId[];
  /** Reference-rate cache TTL. */
  ttlMs: number;
}

export interface PostgresConfig {
  databaseUrl: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId?: string;
}

export interface FxDeltaConfig {
  celo: CeloConfig;
  /** ERC-8021 attribution tag wired into every Celo tx calldata suffix. */
  attributionCode: string;
  selfSettle?: SelfSettleConfig;
  x402: X402Config;
  fx: FxConfig;
  postgres?: PostgresConfig;
  telegram?: TelegramConfig;
}

const DEFAULTS = {
  celoRpcUrl: "https://forno.celo.org",
  celoChainId: 42220,
  celoPollMs: 5_000,
  x402Mode: "self" as X402Mode,
  facilitatorUrl: "https://api.x402.celo.org",
  priceUsd: 0.005,
  fxProviders: ["erapi", "frankfurter", "bcptax"] as FxProviderId[],
  fxTtlMs: 300_000,
} as const;

const KNOWN_FX_PROVIDERS: ReadonlySet<string> = new Set([
  "erapi",
  "frankfurter",
  "bcptax",
  "finnhub",
]);

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function requiredString(name: string, errors: string[]): string | undefined {
  const value = process.env[name];
  if (!value || !value.trim()) {
    errors.push(`Missing required env var: ${name}`);
    return undefined;
  }
  return value.trim();
}

function optionalNumber(
  name: string,
  fallback: number,
  errors: string[],
): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    errors.push(`Invalid ${name}: expected a number, got "${raw}"`);
    return fallback;
  }
  return parsed;
}

/**
 * Load and validate config from process.env.
 * Throws Error with all accumulated problems on failure.
 */
export function loadFxDeltaConfig(): FxDeltaConfig {
  const errors: string[] = [];

  const celo: CeloConfig = {
    rpcUrl: process.env.CELO_RPC_URL?.trim() || DEFAULTS.celoRpcUrl,
    chainId: optionalNumber("CELO_CHAIN_ID", DEFAULTS.celoChainId, errors),
    pollMs: optionalNumber("CELO_POLL_MS", DEFAULTS.celoPollMs, errors),
  };

  const attributionCode =
    requiredString("ATTRIBUTION_CODE", errors) ?? "";

  const x402Mode = (process.env.X402_MODE?.trim() ||
    DEFAULTS.x402Mode) as X402Mode;
  if (x402Mode !== "self" && x402Mode !== "facilitator") {
    errors.push(
      `Invalid X402_MODE: expected "self" or "facilitator", got "${x402Mode}"`,
    );
  }
  const x402: X402Config = {
    mode: x402Mode,
    facilitatorUrl:
      process.env.X402_FACILITATOR_URL?.trim() || DEFAULTS.facilitatorUrl,
    priceUsd: optionalNumber("X402_PRICE_USD", DEFAULTS.priceUsd, errors),
  };

  // selfSettle — submitter key required only when mode=self (D-191-1);
  // setting the key in facilitator mode is allowed (still ours to use).
  const rawPk = process.env.SELLER_PRIVATE_KEY?.trim();
  let selfSettle: SelfSettleConfig | undefined;
  if (rawPk) {
    if (!PRIVATE_KEY_RE.test(rawPk)) {
      errors.push(
        "Invalid SELLER_PRIVATE_KEY: expected 0x-prefixed 64-hex private key",
      );
    }
    const sellerAddress = process.env.SELLER_ADDRESS?.trim();
    if (sellerAddress && !ADDRESS_RE.test(sellerAddress)) {
      errors.push(
        `Invalid SELLER_ADDRESS: expected 0x-prefixed 40-hex address, got "${sellerAddress}"`,
      );
    }
    selfSettle = {
      privateKey: rawPk as `0x${string}`,
      sellerAddress: sellerAddress as `0x${string}` | undefined,
    };
  } else if (x402Mode === "self") {
    errors.push(
      "Missing required env var: SELLER_PRIVATE_KEY (X402_MODE=self needs the tag-wired submitter key)",
    );
  }

  const rawProviders = process.env.FX_PROVIDERS?.trim();
  const fxProviders: FxProviderId[] = rawProviders
    ? rawProviders
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p.length > 0)
        .map((p) => {
          if (!KNOWN_FX_PROVIDERS.has(p)) {
            errors.push(`Unknown FX provider in FX_PROVIDERS: "${p}"`);
          }
          return p as FxProviderId;
        })
    : [...DEFAULTS.fxProviders];
  const fx: FxConfig = {
    providers: fxProviders,
    ttlMs: optionalNumber("FX_TTL_MS", DEFAULTS.fxTtlMs, errors),
  };

  const databaseUrl = process.env.DATABASE_URL?.trim();
  const postgres: PostgresConfig | undefined = databaseUrl
    ? { databaseUrl }
    : undefined;

  const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tgChat = process.env.TELEGRAM_CHAT_ID?.trim();
  let telegram: TelegramConfig | undefined;
  if (tgToken) {
    telegram = { botToken: tgToken, chatId: tgChat || undefined };
  } else if (tgChat) {
    errors.push(
      "TELEGRAM_CHAT_ID set without TELEGRAM_BOT_TOKEN (set both or neither)",
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `fxdelta-tracker config errors:\n  - ${errors.join("\n  - ")}`,
    );
  }

  return {
    celo,
    attributionCode,
    selfSettle,
    x402,
    fx,
    postgres,
    telegram,
  };
}

let cached: FxDeltaConfig | undefined;

/** Cached accessor — loads once, reuse across engine/clients. */
export function getFxDeltaConfig(): FxDeltaConfig {
  if (!cached) cached = loadFxDeltaConfig();
  return cached;
}

/** Test hook — clears the cached config. */
export function resetFxDeltaConfigCache(): void {
  cached = undefined;
}
