/**
 * SLICE-191-0 spike: verify EIP-712 domain params onchain for x402 assets.
 *
 * The Celo facilitator (/supported) reports extra {name, version} per asset —
 * those values must match the token's EIP-712 domain or verify/settle fails.
 * This script reads eip712Domain() directly onchain (Celo mainnet, read-only).
 */
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { celo } from "viem/chains";

// versionOnchain=false: token has no version()/eip712Domain() onchain —
// the facilitator-specified extra value is authoritative (verified via /supported).
const TOKENS: { symbol: string; address: Address; expect: { name: string; version: string }; versionOnchain?: boolean }[] = [
  { symbol: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", expect: { name: "USDC", version: "2" } },
  { symbol: "USDT", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", expect: { name: "Tether USD", version: "1" }, versionOnchain: false },
  { symbol: "USAT", address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771", expect: { name: "Tether America USD", version: "1" } },
  { symbol: "wARS", address: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", expect: { name: "Peso Argentino", version: "1" } },
  { symbol: "wBRL", address: "0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0", expect: { name: "Real Brasileño", version: "1" } },
  { symbol: "wCOP", address: "0x8a1d45e102e886510e891d2ec656a708991e2d76", expect: { name: "Peso Colombiano", version: "1" } },
];

const client = createPublicClient({
  chain: celo,
  transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
});

const domainAbi = parseAbi([
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function decimals() view returns (uint8)",
]);

let failures = 0;

for (const t of TOKENS) {
  let name = "?", version = "?", source = "none";
  try {
    const d = await client.readContract({
      address: t.address,
      abi: domainAbi,
      functionName: "eip712Domain",
    });
    name = d[1];
    version = d[2];
    source = "eip712Domain()";
  } catch {
    // no eip712Domain — fall back to name()/version()
    try {
      name = (await client.readContract({ address: t.address, abi: domainAbi, functionName: "name" })) as string;
      source = "name()";
    } catch { /* leave */ }
    try {
      version = (await client.readContract({ address: t.address, abi: domainAbi, functionName: "version" })) as string;
      source += "+version()";
    } catch { /* leave */ }
  }
  let decimals = "?";
  try {
    decimals = String(await client.readContract({ address: t.address, abi: domainAbi, functionName: "decimals" }));
  } catch { /* leave */ }

  const versionOk = t.versionOnchain === false ? version === "?" || version === t.expect.version : version === t.expect.version;
  const match = name === t.expect.name && versionOk;
  if (!match) failures++;
  const extra = t.versionOnchain === false ? ` (version not onchain; facilitator extra = "${t.expect.version}")` : "";
  console.log(
    `${t.symbol.padEnd(5)} ${t.address}  name="${name}" version="${version}" decimals=${decimals}  [${source}]  ${match ? "MATCH" : "MISMATCH (expected " + JSON.stringify(t.expect) + ")"}${extra}`,
  );
}

console.log(failures === 0 ? "\nPASS: all EIP-712 domains match facilitator extra" : `\nFAIL: ${failures} mismatches`);
process.exit(failures === 0 ? 0 : 1);
