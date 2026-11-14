import { hex } from "@scure/base";
import * as B from "./btc.js";
import * as E from "./esplora.js";
import * as N from "./near.js";
import * as O from "./oneclick.js";
import { estimateFee, payoutKey, signAndSend, spendable } from "./split.js";
import { MEMPOOL_WEB, NEARBLOCKS_WEB, network } from "./config.js";

const FEE_RATE_DEFAULT = 2n; // sat/vB, override with --fee-rate

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

  // FR-007: with an approved quote, pay the 1Click deposit first, remainder to cold.
  const bill = await N.getOpenBill(miner);
  const drill = process.argv.includes("--cold-only") || Boolean(arg("extra-output"));
  if (bill && bill.status !== "QuoteApproved" && !drill) {
    throw new Error(`Bill #${bill.id} is ${bill.status}. A split can only pay a bill with an approved quote.`);
  }
  if (!drill && bill && bill.quote && Number(BigInt(bill.quote.deadline_ns) / 1_000_000n) <= Date.now()) {
    throw new Error(`Bill #${bill.id}'s quote has expired. The host needs to lock a new one.`);
  }
  const hostValue = bill?.status === "QuoteApproved" && bill.quote ? BigInt(bill.quote.amount_in_sats) : 0n;
  const fee = estimateFee(inputs.length, hostValue > 0n ? 2 : 1, rate);
  if (fee > BigInt(m.fee_cap_sats)) throw new Error(`Fee ${fee} sats is over the miner's cap ${m.fee_cap_sats}`);
  const coldValue = total - hostValue - fee;
  // BR-002: wait for more payouts rather than produce a dust cold output.
  if (coldValue < B.DUST_LIMIT) {
    throw new Error(`Inputs (${total} sats) can't cover the bill (${hostValue}) plus fee (${fee}) plus dust. Waiting for more payouts.`);
  }
  let outputs = [
    ...(hostValue > 0n ? [{ address: bill!.quote!.deposit_address, value: hostValue }] : []),
    { address: m.cold_address, value: coldValue },
  ];
  // Phase 5 refusal drills. Each builds a split the contract must refuse.
  if (process.argv.includes("--cold-only")) {
    outputs = [{ address: m.cold_address, value: total - estimateFee(inputs.length, 1, rate) }];
  }
  const extra = arg("extra-output");
  if (extra) {
    const last = outputs[outputs.length - 1];
    last.value -= 1000n;
    outputs = [...outputs, { address: extra, value: 1000n }];
  }

  const tx = B.buildSplitTx(key, inputs, outputs);
  const local = inputs.map((i, idx) => hex.encode(B.sighash(tx, idx, key, i.value)));
  console.log(JSON.stringify({ address, inputs: inputs.map((i) => `${i.txid}:${i.vout}`), total: Number(total),
    bill: bill ? { id: bill.id, deposit: bill.quote?.deposit_address, hostValue: Number(hostValue) } : null,
    fee: Number(fee), cold: m.cold_address, coldValue: Number(coldValue), unsignedTxid: tx.id, sighashes: local }, null, 2));
  if (dryRun) return;

  const r = await signAndSend(miner, key, inputs, outputs, bill, { broadcast: !noBroadcast });
  console.log(`NEAR tx: ${NEARBLOCKS_WEB}/txns/${r.nearTx}`);
  if (r.refused) {
    console.log(JSON.stringify({ refused: true, code: r.code, nearTx: r.nearTx,
      link: `${NEARBLOCKS_WEB}/txns/${r.nearTx}`, note: "No signature was produced, so no Bitcoin transaction can follow." }, null, 2));
    process.exitCode = 3;
    return;
  }
  if (!r.txid) {
    console.log(JSON.stringify({ splitId: r.splitId, verified: true, signedTxid: r.signedTxid, rawTx: r.rawTx }, null, 2));
    return;
  }
  console.log(JSON.stringify({ splitId: r.splitId, txid: r.txid, mempool: `${MEMPOOL_WEB}/tx/${r.txid}` }, null, 2));
  if (bill?.quote && network === "mainnet") console.log(`Submitted deposit tx to 1Click for ${bill.quote.deposit_address}`);
  else if (bill) console.log("Testnet: no 1Click on testnet, so the host output went to the stand-in deposit address.");
}

/** Bill, split, Bitcoin and 1Click status from real sources (FR-012). */
async function cmdStatus(miner: string) {
  const bills = await N.view<N.Bill[]>(N.CONTRACT_ID, "get_bills_for_miner", { miner, limit: 5 });
  for (const b of bills) {
    const out: Record<string, unknown> = { bill: b.id, status: b.status, usd: Number(b.usd_cents) / 100, host: b.host };
    if (b.split_id) {
      const sp = await N.getSplit(Number(b.split_id));
      out.split = { id: b.split_id, status: sp?.status, txid: sp?.txid, mempool: sp ? `${MEMPOOL_WEB}/tx/${sp.txid}` : null };
      if (sp) out.btc = await E.txStatus(sp.txid).catch((e) => `unknown (${e.message})`);
    }
    if (b.quote && network === "mainnet" && ["Paying", "Paid"].includes(b.status)) {
      out.oneclick = await O.swapStatus(b.quote.deposit_address).catch((e) => `unknown (${e.message})`);
    }
    console.log(JSON.stringify(out, null, 2));
  }
  if (bills.length === 0) console.log(`No bills for ${miner}`);
}

const [cmd, miner] = process.argv.slice(2);
const cmds: Record<string, (m: string) => Promise<void>> = { address: cmdAddress, utxos: cmdUtxos, split: cmdSplit, status: cmdStatus };
if (!cmds[cmd] || !miner) {
  console.error("Usage: npm run relayer -- <address|utxos|split|status> <miner.near> [--dry-run] [--no-broadcast] [--cold-only] [--extra-output addr] [--fee-rate N] [--utxo txid:vout:sats ...]");
  process.exit(2);
}
cmds[cmd](miner).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
