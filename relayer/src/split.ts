import { base58, hex } from "@scure/base";
import * as B from "./btc.js";
import * as E from "./esplora.js";
import * as N from "./near.js";
import * as O from "./oneclick.js";
import { network } from "./config.js";

const COINBASE_MATURITY = 100;

/** The miner's payout key, derived by v1.signer and checked against what the contract stored. */
export async function payoutKey(miner: string): Promise<Uint8Array> {
  const derived = await N.derivedPublicKey(miner);
  const [curve, data] = derived.split(":");
  if (curve !== "secp256k1") throw new Error(`Unexpected derived key: ${derived}`);
  const key = B.compressPubkey(base58.decode(data));
  // Before deploy the contract doesn't exist, and derivation alone is still valid.
  const m = await N.getMiner(miner).catch((e) => {
    if (/does not exist|CodeDoesNotExist|MethodNotFound/i.test(String(e?.message ?? e))) return null;
    throw e;
  });
  if (m?.payout_pubkey && m.payout_pubkey !== hex.encode(key)) {
    throw new Error("Contract payout key differs from v1.signer derivation. Refusing to continue.");
  }
  return key;
}

/** Confirmed, mature UTXOs only (BR-004), largest first, at most four. */
export async function spendable(address: string): Promise<B.SplitInput[]> {
  const [utxos, tip] = await Promise.all([E.getUtxos(address), E.getTipHeight()]);
  const out: B.SplitInput[] = [];
  for (const u of utxos) {
    if (!u.status.confirmed || u.status.block_height === undefined) continue;
    if ((await E.isCoinbase(u.txid)) && tip - u.status.block_height + 1 < COINBASE_MATURITY) continue;
    out.push({ txid: u.txid, vout: u.vout, value: BigInt(u.value) });
  }
  return out.sort((a, b) => (a.value > b.value ? -1 : 1)).slice(0, 4);
}

/** P2WPKH in, one segwit v0/v1 out: 10.5 + 68/input + 43/output vbytes, rounded up. */
export function estimateFee(inputs: number, outputs: number, rate: bigint): bigint {
  return BigInt(Math.ceil(10.5 + 68 * inputs + 43 * outputs)) * rate;
}

export type Output = { address: string; value: bigint };

/** What to do with the coins at a payout address right now. Pure, so it can be tested. */
export type Decision =
  | { action: "idle"; reason: string }
  | { action: "wait"; reason: string }
  | { action: "split"; inputs: B.SplitInput[]; outputs: Output[]; fee: bigint; hostValue: bigint };

export function decide(p: {
  inputs: B.SplitInput[];
  bill: N.Bill | null;
  coldAddress: string;
  feeCap: bigint;
  rate: bigint;
  nowMs: number;
}): Decision {
  if (p.inputs.length === 0) return { action: "idle", reason: "nothing confirmed at the payout address" };
  const { bill } = p;
  if (bill && bill.status !== "QuoteApproved") {
    return { action: "wait", reason: `bill #${bill.id} is ${bill.status}, so a split can't pay it yet` };
  }
  if (bill?.quote && Number(BigInt(bill.quote.deadline_ns) / 1_000_000n) <= p.nowMs) {
    return { action: "wait", reason: `bill #${bill.id}'s quote expired, the host needs to lock a new one` };
  }
  const total = p.inputs.reduce((a, i) => a + i.value, 0n);
  const hostValue = bill?.quote ? BigInt(bill.quote.amount_in_sats) : 0n;
  const fee = estimateFee(p.inputs.length, hostValue > 0n ? 2 : 1, p.rate);
  if (fee > p.feeCap) return { action: "wait", reason: `network fee ${fee} sats is over the miner's cap ${p.feeCap}` };
  const coldValue = total - hostValue - fee;
  if (coldValue < B.DUST_LIMIT) {
    return { action: "wait", reason: `${total} sats can't cover the bill (${hostValue}) plus fee (${fee}) yet` };
  }
  const outputs: Output[] = [
    ...(hostValue > 0n ? [{ address: bill!.quote!.deposit_address, value: hostValue }] : []),
    { address: p.coldAddress, value: coldValue },
  ];
  return { action: "split", inputs: p.inputs, outputs, fee, hostValue };
}

export type SplitResult =
  | { refused: true; code: string; nearTx: string }
  | { refused: false; splitId: number; nearTx: string; signedTxid: string; rawTx: string; txid: string | null };

/**
 * Asks the contract for MPC signatures, checks the contract built the same
 * transaction, verifies every signature against the payout key and, unless
 * told not to, broadcasts and hands the deposit to 1Click.
 */
export async function signAndSend(
  miner: string,
  key: Uint8Array,
  inputs: B.SplitInput[],
  outputs: Output[],
  bill: N.Bill | null,
  opts: { broadcast: boolean },
): Promise<SplitResult> {
  const tx = B.buildSplitTx(key, inputs, outputs);
  const local = inputs.map((i, idx) => hex.encode(B.sighash(tx, idx, key, i.value)));
  const r = await N.signSplit(miner, inputs, outputs);
  if (r.failure) return { refused: true, code: r.failure.replace(/^Smart contract panicked: /, ""), nearTx: r.nearTxHash };
  if (r.splitId === null) throw new Error("No split_requested event in the NEAR tx");

  const split = await N.getSplit(r.splitId);
  if (!split || split.status !== "Signed") throw new Error(`Split ${r.splitId} is ${split?.status ?? "missing"}`);
  // The contract and this relayer must agree on every sighash and the txid.
  if (split.txid !== tx.id || split.sighashes.join() !== local.join()) {
    throw new Error("Contract sighash or txid differs from the local build. Not broadcasting.");
  }
  const sigs = split.signatures.map((raw, i) => B.verifyMpcSignature(B.parseMpcSignature(raw), hex.decode(local[i]), key));
  const final = B.finalize(tx, key, sigs);
  if (!opts.broadcast) {
    return { refused: false, splitId: r.splitId, nearTx: r.nearTxHash, signedTxid: final.txid, rawTx: final.hex, txid: null };
  }
  const txid = (await E.broadcast(final.hex)).trim();
  if (bill?.quote && network === "mainnet") {
    await O.submitDeposit(txid, bill.quote.deposit_address).catch(() => {
      // 1Click still detects the deposit on its own; submitting only speeds it up.
    });
  }
  return { refused: false, splitId: r.splitId, nearTx: r.nearTxHash, signedTxid: final.txid, rawTx: final.hex, txid };
}
