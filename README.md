# celo-fx-delta

FX-delta agent for Celo local stablecoin corridors — submission for the
[Agents on Open Rails](https://www.loops.house/agents-on-open-rails) hackathon.

Tracks the onchain premium/discount of local stablecoins (Ripio wFIAT, cNGN,
IDRX, Mento stables) vs official FX reference rates, and sells the real-time
delta feed per-request via x402 on Celo mainnet (USDC/USDT, self-settle,
EIP-3009 `transferWithAuthorization`).

Every transaction sent by this project carries an ERC-8021 attribution tag
(`celo_24acc530146f`) — verify any tx at
[builder-code-checker.vercel.app](https://builder-code-checker.vercel.app).

## Live deployment (Celo mainnet, chain 42220)

| Artifact | Value |
|---|---|
| Live app | https://agentbadge.xyz/hackathon/fxdelta |
| Paid endpoint | `GET https://agentbadge.xyz/api/fx-delta/premium` — 0.005 USDC/call, x402 challenge |
| Free endpoints | `GET /api/fx-delta/corridors` (22 corridors), `GET /api/fx-delta/snapshot` (1 req/min), `GET /api/fx-delta/health` |
| Agent wallet | [`0x0F711f822EF1Ba1736F62CAAbb51F5502758186e`](https://celoscan.io/address/0x0F711f822EF1Ba1736F62CAAbb51F5502758186e) — submits the tagged settle txs |
| ERC-8021 tag | `celo_24acc530146f` |

Unauthenticated `GET /api/fx-delta/premium` returns a real `402` with
`accepts[]` (USDC `0xcebA9300…18C` / USDT `0x48065fbB…D5e`, payTo = agent
wallet) — that challenge **is** the x402 handshake, not an error.

## On-chain artifacts (Celo mainnet)

The project deploys no contracts of its own — the agent registers in the
canonical ERC-8004 Identity Registry
[`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://celoscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)
and settles payments via USDC `transferWithAuthorization` (EIP-3009). All
txs are sent by the agent wallet and carry the ERC-8021 tag in calldata.

| Artifact | Link |
|---|---|
| ERC-8004 **agentId 9980** | [`register` tx `0x6050b7c3…4b81`](https://celoscan.io/tx/0x6050b7c3caada3696ce1e0008ecb7e7dec6e7734c8123846cb29d05d0ca34b81) — tag in calldata |
| Paid settle #1 (0.005 USDC) | [`0x7f292710…5b6b2`](https://celo.blockscout.com/tx/0x7f292710b92b0684b272872d9829899c3a5dcf83819df98908b1bd391355b6b2) — block 80576414, EIP-3009, tag |
| Paid settle #2 | [`0x054cde47…7d2`](https://celo.blockscout.com/tx/0x054cde47d7950bdfa9397055b8b6beed15e2ec292a511cd59d51e9fedf4ee7d2) — 2026-10-20, tag |
| Paid settle #3 | [`0xd5384c55…cf2`](https://celo.blockscout.com/tx/0xd5384c556894d8d1ddaaa2a6907ebee632040be8f22097fc1564298d915b6cf2) — 2026-10-20, tag |
| Paid settle #4 | [`0xada61a6c…b56`](https://celo.blockscout.com/tx/0xada61a6c37ebdc61a5019fc4e3f819b37846e5b5e1201547c0428cdff6fa4b56) — 2026-10-20, tag |

Testnet record (Celo Sepolia, earlier): `agentId=552`, tx
[`0x709ac4…3303`](https://celo-sepolia.blockscout.com/tx/0x709ac46bacb206fac31fc3d8b52e3902336fa08b3acff49d1441ad06c4ed3303)
on registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`.
Current onchain record is cached in `deployments/identity.json`.

## How it works

- `packages/fxdelta-tracker` — the tracker engine: corridor registry
  (22 local-stablecoin corridors), `CeloPriceSource` (Uniswap V3 + Mento
  FPMM legs with TVL/thin-market and oracle-lag gates), `FxRefSource`
  (official-rate cascade erapi → frankfurter → BCB PTAX → paid `buyfx`),
  `DeltaEngine` (premium/discount computation, market phases, weekend
  freeze).
- `scripts/register-agent.ts` — idempotent ERC-8004 registration with
  the ERC-8021 attribution suffix appended to calldata.
- Serving layer (x402 gates, HTTP routes, settle) lives in the AgentBadge
  server; this repo is the agent core + onchain tooling.

## Verify this submission (step by step)

No secrets, wallets or paid calls are needed — every check below is free.
Prerequisite: [Bun](https://bun.sh) ≥ 1.1.

**Step 1 — clone & install**

```bash
git clone https://github.com/spreadzp/celo-fx-delta.git && cd celo-fx-delta
bun install        # expect: dependencies installed, no postinstall secrets needed
```

**Step 2 — run the test suite**

```bash
bun run test       # expect: 5 test files, 59 tests, all passed
```

**Step 3 — reproduce the on-chain identity (no keys)**

```bash
FXDELTA_CHAIN=celo bun scripts/register-agent.ts --dry-run
# expect:
#   chain: celo (42220) rpc=https://forno.celo.org
#   owner: 0x0F711f822EF1Ba1736F62CAAbb51F5502758186e
#   tag:   celo_24acc530146f
#   existing agent onchain: agentId=9980
```

`--dry-run` never touches private keys — it resolves the owner/agentId
onchain and prints the calldata it would send.

**Step 4 — hit the live endpoints**

```bash
curl -s https://agentbadge.xyz/api/fx-delta/health | head -c 400
# expect: {"status":"ok", ... corridors: 22, sources connected}

curl -s https://agentbadge.xyz/api/fx-delta/corridors | head -c 400
# expect: JSON array of corridor objects

curl -s -o /dev/null -w "%{http_code}" https://agentbadge.xyz/api/fx-delta/premium
# expect: 402 — the x402 payment challenge IS the correct response
# (accepts[] lists USDC 0xcebA9300…/USDT 0x48065fbB…, payTo = agent wallet, 5000 µ = 0.005 USDC)
```

**Step 5 — verify the tagged transactions**

Open the five links in "On-chain artifacts" above, or check status
programmatically:

```bash
curl -s "https://celo.blockscout.com/api/v2/transactions/0x6050b7c3caada3696ce1e0008ecb7e7dec6e7734c8123846cb29d05d0ca34b81" \
  | grep -o '"status":"ok"'
# expect: "status":"ok"  — repeat for the other four tx hashes
```

To see the ERC-8021 tag `celo_24acc530146f` in calldata, paste any of the
tx hashes into https://builder-code-checker.vercel.app.

## How to run

Real registration / settle needs `SELLER_PRIVATE_KEY` in `.env` (never
committed — see `.env.example`):

```bash
bun scripts/register-agent.ts               # celoSepolia (default)
FXDELTA_CHAIN=celo bun scripts/register-agent.ts   # mainnet — idempotent, reuses agentId 9980
```

Gas note: on mainnet the wallet pays native CELO — USDC is **not**
whitelisted in this deployment's `FeeCurrencyDirectory`, so fee
abstraction is only used as a fallback when there is no native balance
(see `scripts/register-agent.ts`).

Secrets hygiene: `.env` is gitignored; `.env.example` documents every
variable. Nothing but addresses, tx hashes and placeholders is committed.

## Status

Live on Celo mainnet — agentId 9980, 4 tagged paid settles, x402 paid
endpoint serving. Hackathon window Oct 6 → Nov 9 2026.
