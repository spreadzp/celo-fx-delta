/**
 * SLICE-191-8: ERC-8004 agent registration on Celo + first real
 * ERC-8021-tagged transaction.
 *
 * Identity Registry (canonical, same address on Celo & Celo Sepolia):
 *   0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *
 * Idempotent (AC3):
 *   1. deployments/identity.json hit → verify ownerOf(agentId)==SELLER → done.
 *   2. balanceOf(SELLER) > 0 → resolve agentId via tokenOfOwnerByIndex
 *      or Transfer-log scan → save cache → done (no duplicate register).
 *   3. Otherwise → register(agentURI) with ERC-8021 suffix appended to
 *      calldata, gas paid in USDC (fee abstraction, no CELO needed).
 *
 * Usage:
 *   bun scripts/register-agent.ts             # celoSepolia
 *   FXDELTA_CHAIN=celo bun scripts/register-agent.ts
 *   bun scripts/register-agent.ts --dry-run   # print calldata+tag only
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  concat,
  pad,
  zeroAddress,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";
import { toDataSuffix, fromDataSuffix } from "@celo/attribution-tags";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * ERC-8004 Identity Registry — per-network canonical address
 * (erc-8004/erc-8004-contracts): mainnet chains share 0x8004A169…,
 * testnets share 0x8004A818….
 */
const IDENTITY_REGISTRY = {
  celo: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  celoSepolia: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const;

const USDC = {
  celo: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
  celoSepolia: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
} as const;

const REGISTRY_ABI = parseAbi([
  "function register(string agentURI) returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS = join(root, "deployments", "identity.json");

const chainName = (process.env.FXDELTA_CHAIN ?? "celoSepolia") as
  | "celo"
  | "celoSepolia";
const chain = chainName === "celo" ? celo : celoSepolia;
const rpcUrl =
  chainName === "celo"
    ? (process.env.CELO_RPC_URL ?? "https://forno.celo.org")
    : (process.env.CELO_SEPOLIA_RPC_URL ??
      "https://forno.celo-sepolia.celo-testnet.org");
const dryRun = process.argv.includes("--dry-run");
const registry = IDENTITY_REGISTRY[chainName];
const tagCode =
  process.env.ATTRIBUTION_CODE ??
  (() => {
    throw new Error("ATTRIBUTION_CODE required (loops.house enrollment)");
  })();

interface IdentityCache {
  chainId: number;
  registry: string;
  owner: string;
  agentId: string;
  agentURI: string;
  txHash?: string;
  registeredAt: string;
}

/** ERC-8004 registration-v1 document → data URI (no hosting needed). */
function buildAgentURI(): string {
  const doc = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Celo FX Delta Agent",
    description:
      "Real-time premium/discount feed for Celo local stablecoin corridors " +
      "(wARS, wBRL, wCOP, cNGN, IDRX vs USDT) vs official FX reference rates. " +
      "x402 paid API on Celo mainnet, self-settle, ERC-8021 tagged.",
    services: [
      {
        name: "mcp",
        endpoint: "/mcp/fxdelta",
        version: "1",
      },
      {
        name: "web",
        endpoint: "/api/fx-delta",
        version: "1",
      },
      {
        name: "A2A",
        endpoint: "/.well-known/agent-card.json",
        version: "0.3",
      },
    ],
    x402Support: true,
    active: true,
    registrations: [
      {
        agentRegistry: `eip155:${chain.id}:${IDENTITY_REGISTRY[chainName]}`,
      },
    ],
    supportedTrust: ["reputation"],
    attribution: { erc8021: tagCode },
  };
  return (
    "data:application/json;base64," +
    Buffer.from(JSON.stringify(doc)).toString("base64")
  );
}

/** Resolve existing agentId: enumerable first, Transfer-log fallback. */
async function findAgentId(
  pub: ReturnType<typeof createPublicClient>,
  owner: Address,
): Promise<bigint | null> {
  try {
    return (await pub.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "tokenOfOwnerByIndex",
      args: [owner, 0n],
    })) as bigint;
  } catch {
    // Not enumerable — scan mint Transfers newest→oldest in bounded
    // windows (forno caps getLogs at 100k blocks per query).
    const WINDOW = 100_000n;
    let to = await pub.getBlockNumber();
    while (to > 0n) {
      const from = to > WINDOW ? to - WINDOW : 0n;
      const logs = await pub.getLogs({
        address: registry,
        event: {
          type: "event",
          name: "Transfer",
          inputs: [
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "tokenId", type: "uint256", indexed: true },
          ],
        },
        args: { from: zeroAddress, to: owner },
        fromBlock: from,
        toBlock: to,
      });
      const last = logs.at(-1);
      if (last) return last.args.tokenId as bigint;
      if (from === 0n) break;
      to = from - 1n;
    }
    return null;
  }
}

async function main() {
  const pk = process.env.SELLER_PRIVATE_KEY;
  if (!pk && !dryRun) throw new Error("SELLER_PRIVATE_KEY required");
  const account = pk
    ? privateKeyToAccount(pk as Hex)
    : privateKeyToAccount(
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      );

  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const agentURI = buildAgentURI();
  // Fee abstraction only when USDC is held — native CELO otherwise.
  const usdcAddr = USDC[chainName];
  const usdcBal = await pub
    .readContract({
      address: usdcAddr,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [account.address],
    })
    .catch(() => 0n);
  const feeCurrency = usdcBal > 0n ? usdcAddr : undefined;
  const nativeBal = await pub.getBalance({ address: account.address });
  console.log(
    `gas: ${feeCurrency ? "USDC fee abstraction" : "native CELO"} ` +
      `(native=${nativeBal}, usdc=${usdcBal})`,
  );
  if (nativeBal === 0n && usdcBal === 0n) {
    throw new Error(
      "wallet unfunded — claim CELO at https://faucet.celo.org/celo-sepolia " +
        "or USDC at https://faucet.circle.com",
    );
  }

  console.log(`chain: ${chainName} (${chain.id}) rpc=${rpcUrl}`);
  console.log(`owner: ${account.address}`);
  console.log(`tag:   ${tagCode}`);

  // ── AC3: cache hit → verify ownership → done ─────────────────────
  if (existsSync(DEPLOYMENTS)) {
    const cached = JSON.parse(readFileSync(DEPLOYMENTS, "utf8")) as
      IdentityCache;
    if (cached.chainId === chain.id) {
      try {
        const owner = (await pub.readContract({
          address: registry,
          abi: REGISTRY_ABI,
          functionName: "ownerOf",
          args: [BigInt(cached.agentId)],
        })) as Address;
        if (owner.toLowerCase() === account.address.toLowerCase()) {
          console.log(`already registered: agentId=${cached.agentId}`);
          console.log(`agentURI: ${cached.agentURI.slice(0, 80)}…`);
          if (cached.txHash) console.log(`tx: ${cached.txHash}`);
          return;
        }
        console.log("cache owner mismatch — re-registering");
      } catch {
        console.log("cache stale (agentId not onchain) — re-registering");
      }
    }
  }

  // ── AC3: onchain balance → reuse existing agentId ────────────────
  const balance = (await pub.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  if (balance > 0n) {
    const agentId = await findAgentId(pub, account.address);
    if (agentId !== null) {
      console.log(`existing agent onchain: agentId=${agentId}`);
      const record: IdentityCache = {
        chainId: chain.id,
        registry: registry,
        owner: account.address,
        agentId: agentId.toString(),
        agentURI,
        registeredAt: new Date().toISOString(),
      };
      mkdirSync(dirname(DEPLOYMENTS), { recursive: true });
      writeFileSync(DEPLOYMENTS, JSON.stringify(record, null, 2));
      return;
    }
  }

  // ── register: tagged calldata + USDC fee abstraction ─────────────
  const calldata = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "register",
    args: [agentURI],
  });
  const suffix = toDataSuffix(tagCode);
  const tagged = concat([calldata, suffix]);

  // Verify the tag round-trips from the exact calldata we will send.
  const decoded = fromDataSuffix(tagged);
  if (!decoded?.codes.includes(tagCode)) {
    throw new Error("ERC-8021 tag not recoverable from calldata");
  }
  console.log(`calldata: ${calldata.length / 2 - 1}B + tag ${(suffix.length - 2) / 2}B`);

  if (dryRun) {
    console.log("dry-run — no tx sent");
    console.log(`tagged: ${tagged.slice(0, 66)}…${tagged.slice(-64)}`);
    return;
  }

  const txHash = await wallet.sendTransaction({
    to: registry,
    data: tagged,
    ...(feeCurrency ? { feeCurrency } : {}), // USDC gas when held
  });
  console.log(`tx sent: ${txHash}`);
  console.log(
    `explorer: ${chain.blockExplorers?.default.url}/tx/${txHash}`,
  );

  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`register tx reverted: ${txHash}`);
  }

  // agentId = tokenId from the mint Transfer log (from = 0x0).
  const mintLog = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === registry.toLowerCase() &&
      l.topics[1] === pad(zeroAddress, { size: 32 }),
  );
  if (!mintLog?.topics[3]) throw new Error("mint Transfer log not found");
  const agentId = BigInt(mintLog.topics[3]);

  // Post-verify: tag survives on the real submitted tx.
  const tx = await pub.getTransaction({ hash: txHash });
  const onchainTag = fromDataSuffix(tx.input);
  if (!onchainTag?.codes.includes(tagCode)) {
    throw new Error("ERC-8021 tag missing on submitted tx");
  }
  console.log(`tag verified onchain: ${onchainTag.codes.join(",")}`);

  const record: IdentityCache = {
    chainId: chain.id,
    registry: registry,
    owner: account.address,
    agentId: agentId.toString(),
    agentURI,
    txHash,
    registeredAt: new Date().toISOString(),
  };
  mkdirSync(dirname(DEPLOYMENTS), { recursive: true });
  writeFileSync(DEPLOYMENTS, JSON.stringify(record, null, 2));
  console.log(`agentId=${agentId} saved → deployments/identity.json`);
  console.log(
    `checker: https://builder-code-checker.vercel.app (tx ${txHash})`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
