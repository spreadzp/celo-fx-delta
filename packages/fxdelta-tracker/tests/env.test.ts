/**
 * SLICE-191-1: fxdelta-tracker env config tests.
 *
 * Pattern ported from @agentbadge/bstock-tracker tests/env.test.ts —
 * snapshot/restore process.env + resetFxDeltaConfigCache() per case,
 * error accumulation asserted across sections.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadFxDeltaConfig,
  getFxDeltaConfig,
  resetFxDeltaConfigCache,
} from "../src/env.js";

const FXD_VARS = [
  "ATTRIBUTION_CODE",
  "CELO_RPC_URL",
  "CELO_CHAIN_ID",
  "SELLER_PRIVATE_KEY",
  "SELLER_ADDRESS",
  "X402_MODE",
  "X402_FACILITATOR_URL",
  "X402_PRICE_USD",
  "FX_PROVIDERS",
  "FX_TTL_MS",
  "DATABASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
];

const PK = `0x${"ab".repeat(32)}`;
const ADDR = `0x${"cd".repeat(20)}`;

function setRequired(): void {
  process.env.ATTRIBUTION_CODE = "celo_24acc530146f";
  process.env.SELLER_PRIVATE_KEY = PK;
}

describe("SLICE-191-1: fxdelta-tracker env config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const v of FXD_VARS) delete process.env[v];
    resetFxDeltaConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetFxDeltaConfigCache();
  });

  it("accumulates ALL missing/invalid vars in one error", () => {
    // empty env: ATTRIBUTION_CODE missing + SELLER_PRIVATE_KEY missing
    // (X402_MODE defaults to self → key required)
    let msg = "";
    try {
      loadFxDeltaConfig();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/ATTRIBUTION_CODE/);
    expect(msg).toMatch(/SELLER_PRIVATE_KEY/);

    // multiple bad values also accumulate
    process.env.ATTRIBUTION_CODE = "celo_x";
    process.env.SELLER_PRIVATE_KEY = "not-a-key";
    process.env.SELLER_ADDRESS = "0xbad";
    process.env.CELO_CHAIN_ID = "abc";
    process.env.X402_MODE = "bogus";
    process.env.X402_PRICE_USD = "free!";
    process.env.FX_PROVIDERS = "erapi,unknown-fx";
    process.env.TELEGRAM_CHAT_ID = "123";
    msg = "";
    try {
      loadFxDeltaConfig();
    } catch (e) {
      msg = (e as Error).message;
    }
    for (const needle of [
      "SELLER_PRIVATE_KEY",
      "SELLER_ADDRESS",
      "CELO_CHAIN_ID",
      "X402_MODE",
      "X402_PRICE_USD",
      "unknown-fx",
      "TELEGRAM_BOT_TOKEN",
    ]) {
      expect(msg).toContain(needle);
    }
  });

  it("loads with required vars and applies defaults", () => {
    setRequired();
    const cfg = loadFxDeltaConfig();

    expect(cfg.attributionCode).toBe("celo_24acc530146f");
    expect(cfg.celo.rpcUrl).toBe("https://forno.celo.org");
    expect(cfg.celo.chainId).toBe(42220);
    expect(cfg.x402.mode).toBe("self");
    expect(cfg.x402.facilitatorUrl).toBe("https://api.x402.celo.org");
    expect(cfg.x402.priceUsd).toBe(0.005);
    expect(cfg.fx.providers).toEqual(["erapi", "frankfurter", "bcptax"]);
    expect(cfg.fx.ttlMs).toBe(300_000);
    expect(cfg.selfSettle!.privateKey).toBe(PK);
    expect(cfg.postgres).toBeUndefined();
    expect(cfg.telegram).toBeUndefined();
  });

  it("selfSettle key optional when X402_MODE=facilitator", () => {
    process.env.ATTRIBUTION_CODE = "celo_x";
    process.env.X402_MODE = "facilitator";
    const cfg = loadFxDeltaConfig();
    expect(cfg.selfSettle).toBeUndefined();
    expect(cfg.x402.mode).toBe("facilitator");
  });

  it("seller address captured when valid", () => {
    setRequired();
    process.env.SELLER_ADDRESS = ADDR;
    const cfg = loadFxDeltaConfig();
    expect(cfg.selfSettle!.sellerAddress).toBe(ADDR);
  });

  it("FX_PROVIDERS parses csv, order preserved, trimmed", () => {
    setRequired();
    process.env.FX_PROVIDERS = " frankfurter , bcptax ,";
    const cfg = loadFxDeltaConfig();
    expect(cfg.fx.providers).toEqual(["frankfurter", "bcptax"]);
  });

  it("postgres section present only with DATABASE_URL", () => {
    setRequired();
    process.env.DATABASE_URL = "postgres://u:p@h:5432/db";
    const cfg = loadFxDeltaConfig();
    expect(cfg.postgres!.databaseUrl).toBe("postgres://u:p@h:5432/db");
  });

  it("telegram needs both token and is optional", () => {
    setRequired();
    process.env.TELEGRAM_BOT_TOKEN = "tg";
    process.env.TELEGRAM_CHAT_ID = "42";
    const cfg = loadFxDeltaConfig();
    expect(cfg.telegram).toEqual({ botToken: "tg", chatId: "42" });
  });

  it("getFxDeltaConfig caches; reset clears", () => {
    setRequired();
    const first = getFxDeltaConfig();
    process.env.ATTRIBUTION_CODE = "changed";
    expect(getFxDeltaConfig()).toBe(first);
    resetFxDeltaConfigCache();
    expect(getFxDeltaConfig().attributionCode).toBe("changed");
  });
});
