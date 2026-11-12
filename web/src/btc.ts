import * as btc from "@scure/btc-signer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58, hex } from "@scure/base";
import { btcNetwork } from "./config";

/** `secp256k1:<base58 x||y>` from v1.signer -> compressed key hex and P2WPKH address. */
export function payoutFromDerivedKey(derived: string): { pubkey: string; address: string } {
  const [curve, data] = derived.split(":");
  if (curve !== "secp256k1" || !data) throw new Error(`Unexpected derived key: ${derived}`);
  const xy = base58.decode(data);
  const pub = secp256k1.Point.fromBytes(Uint8Array.from([0x04, ...xy])).toBytes(true);
  return { pubkey: hex.encode(pub), address: btc.p2wpkh(pub, btcNetwork).address! };
}

/** Same rule as the contract: a segwit (bech32/bech32m) address on this network. */
export function coldAddressError(address: string): string | null {
  const a = address.trim();
  if (!a) return "Enter your cold wallet address.";
  const prefix = btcNetwork.bech32 + "1";
  const other = prefix === "tb1" ? "bc1" : "tb1";
  if (a.toLowerCase().startsWith(other)) {
    return `That's a ${other === "bc1" ? "mainnet" : "testnet"} address. This app runs on ${prefix === "tb1" ? "testnet" : "mainnet"}, so use one starting with ${prefix}.`;
  }
  if (!a.toLowerCase().startsWith(prefix)) {
    return `Use a native segwit address starting with ${prefix} (legacy 1... and 3... addresses aren't supported).`;
  }
  try {
    const decoded = btc.Address(btcNetwork).decode(a);
    if (!["wpkh", "wsh", "tr"].includes(decoded.type)) return "Unsupported address type.";
    return null;
  } catch {
    return "That address doesn't pass the checksum. Check for a typo.";
  }
}
