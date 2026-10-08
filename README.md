# celo-fx-delta

FX-delta agent for Celo local stablecoin corridors — submission for the
[Agents on Open Rails](https://www.loops.house/agents-on-open-rails) hackathon.

Tracks the onchain premium/discount of local stablecoins (Ripio wFIAT, cNGN,
IDRX, Mento stables) vs official FX reference rates, and sells the real-time
delta feed per-request via x402 on Celo mainnet (USDC/USDT, self-settle).

Every transaction sent by this project carries an ERC-8021 attribution tag.

## Status

Early development — hackathon window Oct 6 → Nov 9 2026.
