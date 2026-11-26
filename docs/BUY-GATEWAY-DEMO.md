# SLICE-191-10 demo-log — buy-gateway buyer

Agent buys a paid data call through the `@celo/buy` gateway
(`gateway.usebuy.ai`, HTTP-402 on Celo mainnet), spend-gated by the
agent-wallet envelope (spend-kind `buy-gateway`).

## Prereqs

```sh
npx @celo/buy@0.8.1 setup --name buy   # wallet → OS keychain
npx @celo/buy@0.8.1 whoami             # print address → fund USDC on Celo
```

## Commands

```sh
# 1. Free live catalog — pick a capability (no auth, no payment)
curl --fail --silent https://gateway.usebuy.ai/v1/catalog | jq '.capabilities | length'

# 2. Free 402 quote — challenge is the price authority
curl --silent --include -X POST -H 'content-type: application/json' \
  -d '{"symbols":"NGN,KES"}' "$BUY_FX_API_URL"
# → 402 { accepts: [{ maxAmountRequired: "…" }] }

# 3. Envelope-gated paid call (server-side guard, then buy curl)
export BUY_GATEWAY_ENABLED=true BUY_WALLET=0x…
npx tsx scripts/buy-gateway-demo.mts fx
```

Dry-run on Sepolia: `BUY_SANDBOX=true` adds `-s` to the `buy curl` args
(pays with Sepolia tokens instead of mainnet USDC).

`buyPay()` internally runs:

```sh
npx @celo/buy@0.8.1 curl --max-amount '<quote.maxAmount>' \
  --request POST --data '{"symbols":"NGN,KES"}' "$BUY_FX_API_URL"
```

## Expected output shape

```
[1] GET https://gateway.usebuy.ai/v1/catalog
    171 capabilities; matching "fx": …
[2] quote https://gateway.usebuy.ai/v1/… {"symbols":"NGN,KES"}
    maxAmountRequired: 0.05
[3] buyPay (envelope: perTx $0.50, approval >$0.25)
    → paid (1 attempt(s))
    tx: 0x<celo settle txHash>
[4] ledger entries:
    sp_… buy-gateway $0.05 → settled
[5] createBuyFx → FxRefSource map: { NGN: 1521.4, KES: 129.3 }
```

## Behaviors under test (tests/buy-gateway.test.ts, 10 cases)

- kill-switch `BUY_GATEWAY_ENABLED≠true` → `disabled`, no spawn, no ledger
- perTx cap exceeded → `denied` (durable denied entry), CLI never spawned
- `allowedKinds` without `buy-gateway` → `denied`
- amount > `approvalAboveUsd` → `approval_required`, parked intent,
  owner approve → one-shot permit consumed on retry
- suspended wallet → `denied` (kill-switch branch first)
- 503/4xx refusal → retried once, entry `released`
- `settle_uncertain` / `retryable:false` → `uncertain`, NEVER retried,
  entry `failed` — treat-as-float rule

## ERC-8021 tag (AC3)

The gateway settle-tx is facilitator-submitted and can't carry our tag
(same constraint as remote facilitator settle in celo-settle.ts). The
companion tx is ours: every paid purchase emits `fxdelta-buy` topic on
Arc `AgentEventLog` (0x1bb6A87D…4700) with `ATTRIBUTION_CODE` ERC-8021
suffix + `purchaseTxHash` in payload → tagged tx on the leaderboard,
decode-checkable via builder-code-checker.

## SQD reserve (bonus)

`lib/buy/sqd.ts` — free `/sqd/` endpoints (datasets, finalized-head,
timestamps, stream) for unpaid on-chain data across 113+ networks.
