# celo-fx-delta

FX-delta agent for Celo local stablecoin corridors — submission for the
[Agents on Open Rails](https://www.loops.house/agents-on-open-rails) hackathon.

Tracks the onchain premium/discount of local stablecoins (Ripio wFIAT, cNGN,
IDRX, Mento stables) vs official FX reference rates, and sells the real-time
delta feed per-request via x402 on Celo mainnet (USDC/USDT, self-settle).

Every transaction sent by this project carries an ERC-8021 attribution tag.

## ERC-8004 identity

The agent registers on the canonical Identity Registry
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (same address on Celo and
Celo Sepolia). Registration is idempotent — re-running reads the cached
`deployments/identity.json` or resolves the existing token onchain.

```bash
bun scripts/register-agent.ts --dry-run    # verify calldata + tag
bun scripts/register-agent.ts              # celoSepolia (default)
FXDELTA_CHAIN=celo bun scripts/register-agent.ts   # mainnet
```

The register calldata carries the ERC-8021 suffix (verify via
[builder-code-checker](https://builder-code-checker.vercel.app)); gas is
paid in USDC through Celo fee abstraction, so the wallet needs USDC only.

## Status

Early development — hackathon window Oct 6 → Nov 9 2026.
