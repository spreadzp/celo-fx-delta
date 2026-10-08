/**
 * SLICE-191-0 spike: Uniswap V3 pool inventory + TVL estimate on Celo mainnet.
 *
 * For every candidate local stable × quote (USDT/USDC/USDm) × fee tier,
 * resolve the pool via the factory, then read token balances held by the
 * pool. TVL(USD) ≈ 2 × stable-quote side (pools are ~50/50 around parity).
 *
 * Read-only. Output: JSON table → corridors draft.
 */
import { createPublicClient, http, parseAbi, formatUnits, type Address } from "viem";
import { celo } from "viem/chains";

const UNISWAP_V3_FACTORY: Address = "0xAfE208a311B21f13EF87E33A90049fC17A7acDEc";
const FEES = [100, 500, 3000, 10000] as const;

const QUOTES: Record<string, { address: Address; decimals: number }> = {
  USDT: { address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
  USDC: { address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6 },
  USDm: { address: "0x765de816845861e75a25fca122bb6898b8b1282a", decimals: 18 },
};

const LOCALS: Record<string, { address: Address; decimals: number }> = {
  wARS: { address: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", decimals: 18 },
  wBRL: { address: "0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0", decimals: 18 },
  wCOP: { address: "0x8a1d45e102e886510e891d2ec656a708991e2d76", decimals: 18 },
  wMXN: { address: "0x337e7456b420bd3481e7fa61fa9850343d610d34", decimals: 18 },
  wPEN: { address: "0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE", decimals: 18 },
  wCLP: { address: "0x61D450a098b6a7f69fC4b98CE68198fe59768651", decimals: 18 },
  cNGN: { address: "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f", decimals: 6 },
  IDRX: { address: "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22", decimals: 2 },
  BRLA: { address: "0xfecb3f7c54e2caae9dc6ac9060a822d47e053760", decimals: 18 },
  COPM: { address: "0xC92E8Fc2947E32F2B574CCA9F2F12097A71d5606", decimals: 18 },
  USAT: { address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771", decimals: 6 },
  EURm: { address: "0xd8763cba276a3738e6de85b4b3bf5fded6d6ca73", decimals: 18 },
  BRLm: { address: "0xe8537a3d056da446677b9e9d6c5db704eaab4787", decimals: 18 },
  COPm: { address: "0x8a567e2ae79ca692bd748ab832081c45de4041ea", decimals: 18 },
  KESm: { address: "0x456a3D042C0DbD3db53D5489e98dFb038553B0d0", decimals: 18 },
  NGNm: { address: "0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71", decimals: 18 },
  GHSm: { address: "0xfAeA5F3404bbA20D3cc2f8C4B0A888F55a3c7313", decimals: 18 },
  XOFm: { address: "0x73F93dcc49cB8A239e2032663e9475dd5ef29A08", decimals: 18 },
  JPYm: { address: "0xc45eCF20f3CD864B32D9794d6f76814aE8892e20", decimals: 18 },
  AUDm: { address: "0x7175504C455076F15c04A2F90a8e352281F492F9", decimals: 18 },
  GBPm: { address: "0xCCF663b1fF11028f0b19058d0f7B674004a40746", decimals: 18 },
  CHFm: { address: "0xb55a79F398E759E43C95b979163f30eC87Ee131D", decimals: 18 },
};

const client = createPublicClient({
  chain: celo,
  transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
  batch: { multicall: true },
});

const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"]);

const ZERO = "0x0000000000000000000000000000000000000000";

type Row = {
  pair: string;
  fee: number;
  pool: Address;
  quoteLegUsd: number;
  tvlUsdApprox: number;
  liquidity: string;
};

async function main() {
  // 1) resolve all pools via factory.getPool (batched)
  const pairs: { local: string; quote: string; fee: number }[] = [];
  for (const local of Object.keys(LOCALS))
    for (const quote of Object.keys(QUOTES))
      for (const fee of FEES) pairs.push({ local, quote, fee });

  console.log(`Resolving ${pairs.length} pool candidates via factory.getPool…`);
  const poolResults = await Promise.allSettled(
    pairs.map((p) =>
      client.readContract({
        address: UNISWAP_V3_FACTORY,
        abi: factoryAbi,
        functionName: "getPool",
        args: [LOCALS[p.local].address, QUOTES[p.quote].address, p.fee],
      }),
    ),
  );

  const found: { local: string; quote: string; fee: number; pool: Address }[] = [];
  poolResults.forEach((r, i) => {
    if (r.status === "fulfilled" && (r.value as string) !== ZERO) {
      found.push({ ...pairs[i], pool: r.value as Address });
    }
  });
  console.log(`Found ${found.length} pools.\n`);

  // 2) for each pool: quote-token balanceOf(pool) → approx TVL = 2 × quote side
  const rows: Row[] = [];
  for (const f of found) {
    const q = QUOTES[f.quote];
    const [quoteBal, localBal, liq] = await Promise.all([
      client.readContract({ address: q.address, abi: erc20Abi, functionName: "balanceOf", args: [f.pool] }),
      client.readContract({ address: LOCALS[f.local].address, abi: erc20Abi, functionName: "balanceOf", args: [f.pool] }),
      client.readContract({ address: f.pool, abi: poolAbi, functionName: "liquidity" }).catch(() => 0n),
    ]);
    const quoteLegUsd = Number(formatUnits(quoteBal as bigint, q.decimals));
    const localLeg = Number(formatUnits(localBal as bigint, LOCALS[f.local].decimals));
    rows.push({
      pair: `${f.local}/${f.quote}`,
      fee: f.fee,
      pool: f.pool,
      quoteLegUsd,
      tvlUsdApprox: quoteLegUsd * 2, // parity assumption, gate is $50k so ±2x is fine
      liquidity: (liq as bigint).toString(),
    });
    console.log(
      `${(f.local + "/" + f.quote).padEnd(12)} fee=${String(f.fee).padEnd(5)} pool=${f.pool}  quote=$${quoteLegUsd.toFixed(0).padStart(9)}  local=${localLeg.toFixed(0).padStart(14)}  TVL~$${(quoteLegUsd * 2).toFixed(0).padStart(9)}  liq=${liq}`,
    );
  }

  // 3) corridor verdict per local stable: best pool across quotes
  console.log("\n=== Corridor verdicts (best TVL per local) ===");
  const byLocal = new Map<string, Row>();
  for (const r of rows) {
    const local = r.pair.split("/")[0];
    const cur = byLocal.get(local);
    if (!cur || r.tvlUsdApprox > cur.tvlUsdApprox) byLocal.set(local, r);
  }
  let ok = 0;
  for (const [local, r] of [...byLocal.entries()].sort((a, b) => b[1].tvlUsdApprox - a[1].tvlUsdApprox)) {
    const pass = r.tvlUsdApprox >= 50_000;
    if (pass) ok++;
    console.log(`${local.padEnd(6)} best=${r.pair} fee=${r.fee} TVL~$${r.tvlUsdApprox.toFixed(0)}  ${pass ? "PASS ≥$50k" : "thin"}`);
  }
  console.log(`\n${ok} corridors ≥ $50k (AC needs ≥4)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
