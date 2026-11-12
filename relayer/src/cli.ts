import { base58, hex } from "@scure/base";
import * as B from "./btc.js";
import * as E from "./esplora.js";
import * as N from "./near.js";
import { MEMPOOL_WEB, NEARBLOCKS_WEB, network } from "./config.js";

const COINBASE_MATURITY = 100;
const FEE_RATE_DEFAULT = 2n; // sat/vB, override with --fee-rate

async function payoutKey(miner: string): Promise<Uint8Array> {
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

/** Confirmed, mature UTXOs only (BR-004). */
async function spendable(address: string): Promise<B.SplitInput[]> {
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
function estimateFee(inputs: number, outputs: number, rate: bigint): bigint {
  return BigInt(Math.ceil(10.5 + 68 * inputs + 43 * outputs)) * rate;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Every value of a repeatable flag, e.g. --utxo a --utxo b. */
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]] : []));
}

/** --utxo <txid>:<vout>:<sats> skips the Esplora lookup. The contract still checks every rule. */
function manualInputs(): B.SplitInput[] {
  return args("utxo").map((u) => {
    const [txid, vout, value] = u.split(":");
    if (!/^[0-9a-f]{64}$/.test(txid ?? "") || !/^\d+$/.test(vout ?? "") || !/^\d+$/.test(value ?? "")) {
      throw new Error(`--utxo must be <txid>:<vout>:<sats>, got ${u}`);
    }
    return { txid, vout: Number(vout), value: BigInt(value) };
  });
}

async function cmdAddress(miner: string) {
  const key = await payoutKey(miner);
  const address = B.payoutAddress(key);
  console.log(JSON.stringify({ network, miner, path: `miner/${miner}`, pubkey: hex.encode(key), address,
    explorer: `${MEMPOOL_WEB}/address/${address}` }, null, 2));
}

async function cmdUtxos(miner: string) {
  const address = B.payoutAddress(await payoutKey(miner));
  console.log(JSON.stringify({ address, all: await E.getUtxos(address),
    spendable: (await spendable(address)).map((u) => ({ ...u, value: Number(u.value) })) }, null, 2));
}

async function cmdSplit(miner: string) {
  const dryRun = process.argv.includes("--dry-run");
  const noBroadcast = process.argv.includes("--no-broadcast");
  const rate = BigInt(arg("fee-rate") ?? FEE_RATE_DEFAULT);
  const key = await payoutKey(miner);
  const address = B.payoutAddress(key);
  const m = await N.getMiner(miner);
  if (!m) throw new Error(`Miner ${miner} is not registered`);

  const manual = manualInputs();
  const inputs = manual.length ? manual : await spendable(address);
  if (inputs.length === 0) throw new Error(`No confirmed spendable UTXOs at ${address}`);
  const total = inputs.reduce((a, i) => a + i.value, 0n);
  const fee = estimateFee(inputs.length, 1, rate);
  if (fee > BigInt(m.fee_cap_sats)) throw new Error(`Fee ${fee} sats is over the miner's cap ${m.fee_cap_sats}`);
  const coldValue = total - fee;
  if (coldValue < B.DUST_LIMIT) throw new Error("Inputs can't cover fee plus dust limit. Waiting for more payouts.");
  const outputs = [{ address: m.cold_address, value: coldValue }];

  const tx = B.buildSplitTx(key, inputs, outputs);
  const local = inputs.map((i, idx) => hex.encode(B.sighash(tx, idx, key, i.value)));
  console.log(JSON.stringify({ address, inputs: inputs.map((i) => `${i.txid}:${i.vout}`), total: Number(total),
    fee: Number(fee), cold: m.cold_address, coldValue: Number(coldValue), unsignedTxid: tx.id, sighashes: local }, null, 2));
  if (dryRun) return;

  const r = await N.signSplit(miner, inputs, outputs);
  console.log(`NEAR tx: ${NEARBLOCKS_WEB}/txns/${r.nearTxHash}  gas burnt: ${r.gasBurnt}`);
  if (r.failure) throw new Error(`Refused by contract: ${r.failure}`);
  if (r.splitId === null) throw new Error("No split_requested event in the NEAR tx");

  const split = await N.getSplit(r.splitId);
  if (!split || split.status !== "Signed") throw new Error(`Split ${r.splitId} is ${split?.status ?? "missing"}`);
  // The contract and this relayer must agree on every sighash and the txid.
  if (split.txid !== tx.id || split.sighashes.join() !== local.join()) {
    throw new Error("Contract sighash or txid differs from the local build. Not broadcasting.");
  }
  const sigs = split.signatures.map((raw, i) =>
    B.verifyMpcSignature(B.parseMpcSignature(raw), hex.decode(local[i]), key));
  const final = B.finalize(tx, key, sigs);
  if (noBroadcast) {
    console.log(JSON.stringify({ splitId: r.splitId, verified: true, signedTxid: final.txid, rawTx: final.hex }, null, 2));
    return;
  }
  const txid = (await E.broadcast(final.hex)).trim();
  console.log(JSON.stringify({ splitId: r.splitId, txid, mempool: `${MEMPOOL_WEB}/tx/${txid}` }, null, 2));
}

const [cmd, miner] = process.argv.slice(2);
const cmds: Record<string, (m: string) => Promise<void>> = { address: cmdAddress, utxos: cmdUtxos, split: cmdSplit };
if (!cmds[cmd] || !miner) {
  console.error("Usage: npm run relayer -- <address|utxos|split> <miner.near> [--dry-run] [--no-broadcast] [--fee-rate N] [--utxo txid:vout:sats ...]");
  process.exit(2);
}
cmds[cmd](miner).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
