import * as btc from "@scure/btc-signer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hex } from "@scure/base";
import { btcNetwork } from "./config.js";

/** Must match the contract constants (ADR-002). */
export const TX_VERSION = 2;
export const TX_SEQUENCE = 0xfffffffd;
export const TX_LOCK_TIME = 0;
export const SIGHASH_ALL = 1;
export const DUST_LIMIT = 546n;

export interface SplitInput {
  txid: string; // display order
  vout: number;
  value: bigint;
}

export interface SplitOutput {
  address: string;
  value: bigint;
}

export interface MpcSignature {
  r: Uint8Array;
  s: Uint8Array;
  recoveryId: number;
}

/** Uncompressed `secp256k1:<base58 x||y>` or raw 64/65-byte key -> 33-byte compressed key. */
export function compressPubkey(xy: Uint8Array): Uint8Array {
  const raw = xy.length === 64 ? Uint8Array.from([0x04, ...xy]) : xy;
  return secp256k1.Point.fromBytes(raw).toBytes(true);
}

export function payoutAddress(pubkey: Uint8Array, net = btcNetwork): string {
  return btc.p2wpkh(pubkey, net).address!;
}

/** Unsigned split transaction, serialized exactly as the contract does. */
export function buildSplitTx(
  pubkey: Uint8Array,
  inputs: SplitInput[],
  outputs: SplitOutput[],
  net = btcNetwork,
): btc.Transaction {
  const tx = new btc.Transaction({ version: TX_VERSION, lockTime: TX_LOCK_TIME });
  const script = btc.p2wpkh(pubkey, net).script;
  for (const i of inputs) {
    tx.addInput({
      txid: i.txid,
      index: i.vout,
      sequence: TX_SEQUENCE,
      witnessUtxo: { script, amount: i.value },
    });
  }
  for (const o of outputs) tx.addOutputAddress(o.address, o.value, net);
  return tx;
}

/** Independent BIP143 sighash, used to cross-check the contract. */
export function sighash(tx: btc.Transaction, index: number, pubkey: Uint8Array, value: bigint): Uint8Array {
  const scriptCode = btc.p2pkh(pubkey).script;
  return tx.preimageWitnessV0(index, scriptCode, SIGHASH_ALL, value);
}

/** Parses one raw `v1.signer` sign response. */
export function parseMpcSignature(raw: string): MpcSignature {
  const j = JSON.parse(raw);
  const bigR = hex.decode(j?.big_r?.affine_point ?? "");
  const s = hex.decode(j?.s?.scalar ?? "");
  const recoveryId = j?.recovery_id;
  if (bigR.length !== 33 || s.length !== 32 || ![0, 1, 2, 3].includes(recoveryId)) {
    throw new Error(`Malformed MPC signature: ${raw}`);
  }
  return { r: bigR.slice(1), s, recoveryId };
}

/**
 * FR-011: a signature is only valid if it recovers to the derived key and
 * verifies against it. Recovery alone returns some key even for forgeries.
 */
export function verifyMpcSignature(sig: MpcSignature, msg: Uint8Array, pubkey: Uint8Array): Uint8Array {
  const compact = Uint8Array.from([...sig.r, ...sig.s]);
  const recovered = secp256k1.Signature.fromBytes(compact, "compact")
    .addRecoveryBit(sig.recoveryId)
    .recoverPublicKey(msg)
    .toBytes(true);
  if (hex.encode(recovered) !== hex.encode(pubkey)) {
    throw new Error("MPC signature does not recover to the payout key");
  }
  if (!secp256k1.verify(compact, msg, pubkey, { prehash: false, lowS: true })) {
    throw new Error("MPC signature failed verification");
  }
  return compact;
}

/** Adds P2WPKH witnesses and returns the broadcastable tx. */
export function finalize(tx: btc.Transaction, pubkey: Uint8Array, compactSigs: Uint8Array[]): { hex: string; txid: string } {
  compactSigs.forEach((compact, i) => {
    const der = secp256k1.Signature.fromBytes(compact, "compact").toBytes("der");
    tx.updateInput(i, { finalScriptWitness: [Uint8Array.from([...der, SIGHASH_ALL]), pubkey] }, true);
  });
  return { hex: tx.hex, txid: tx.id };
}
