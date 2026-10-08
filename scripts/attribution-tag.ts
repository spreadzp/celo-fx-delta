/**
 * SLICE-191-0 spike: ERC-8021 attribution tag encode/decode self-check.
 *
 * Usage:
 *   bun scripts/attribution-tag.ts [code]
 *   ATTRIBUTION_CODE=celo_xxxxxxxx bun scripts/attribution-tag.ts
 *
 * The real code is issued by loops.house at enrollment. Until then we use a
 * placeholder to validate the wiring path end-to-end.
 */
import { toDataSuffix, fromDataSuffix } from "@celo/attribution-tags";
import { concat, encodeFunctionData, parseAbi, type Hex } from "viem";

const ERC8021_MARKER = "0x80218021802180218021802180218021";
const code = process.argv[2] ?? process.env.ATTRIBUTION_CODE ?? "celo_fxdelta";

// --- encode ---
const suffix = toDataSuffix(code);
console.log(`code:    ${code}`);
console.log(`suffix:  ${suffix} (${(suffix.length - 2) / 2} bytes)`);

if (!suffix.toLowerCase().endsWith(ERC8021_MARKER.slice(2))) {
  throw new Error("suffix missing ERC-8021 end marker");
}

// --- decode round-trip ---
const decoded = fromDataSuffix(suffix);
console.log(`decoded: ${JSON.stringify(decoded)}`);
if (!decoded || !decoded.codes.includes(code)) {
  throw new Error("round-trip decode failed");
}

// --- wire check: suffix survives concat onto real calldata ---
const calldata = encodeFunctionData({
  abi: parseAbi(["function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)"]),
  functionName: "transferWithAuthorization",
  args: [
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000002",
    1000n, 0n, 999999999999n,
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    27,
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  ],
});
const tagged = concat([calldata, suffix]);
const decodedFromTx = fromDataSuffix(tagged);
if (!decodedFromTx || !decodedFromTx.codes.includes(code)) {
  throw new Error("tag not recoverable from tagged calldata");
}
console.log(`tagged calldata: ${(tagged.length - 2) / 2} bytes, tag recoverable: yes`);

// --- multi-code (own code + issued code later) ---
const multi = toDataSuffix(["fxdelta", code]);
const multiDecoded = fromDataSuffix(multi);
if (!multiDecoded || multiDecoded.codes.length !== 2) {
  throw new Error("multi-code suffix failed");
}
console.log(`multi-code ok:  ${JSON.stringify(multiDecoded.codes)}`);

console.log("\nPASS: ERC-8021 tag encode/decode verified");
