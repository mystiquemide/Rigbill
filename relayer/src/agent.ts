/**
 * Rigbill keeper agent. Watches the payout addresses of the miners it serves
 * and splits each confirmed payout on its own: the open bill's quote first,
 * the rest to the miner's cold wallet. It holds no keys to anyone's Bitcoin.
 * The contract decides what may be signed, so the worst a broken agent can do
 * is nothing.
 *
 *   npm run agent -- <miner.near> [more miners] [--interval 60] [--once] [--dry-run]
 *
 * Needs RELAYER_ACCOUNT_ID and RELAYER_PRIVATE_KEY, and each miner must have
 * approved that account under Approved relayers (or be that account).
 */
import * as B from "./btc.js";
import { ESPLORA_URLS, MEMPOOL_WEB, NEARBLOCKS_WEB, network } from "./config.js";
import * as N from "./near.js";
import * as O from "./oneclick.js";
import { decide, payoutKey, signAndSend, spendable } from "./split.js";

const flag = (name: string) => process.argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const miners = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--interval") && !all[i - 1]?.startsWith("--fee-rate"));
const intervalS = Number(opt("interval") ?? 60);
const once = flag("once");
const dryRun = flag("dry-run");

const log = (miner: string, event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), network, miner, event, ...data }, (_, v) => (typeof v === "bigint" ? Number(v) : v)));

/** Fee rate for confirmation within about 30 minutes, falling back to a fixed rate. */
async function feeRate(): Promise<bigint> {
  const fixed = opt("fee-rate");
  if (fixed) return BigInt(fixed);
  if (network === "mainnet") {
    for (const base of ESPLORA_URLS) {
      const r = await fetch(`${base}/v1/fees/recommended`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (r?.ok) return BigInt(Math.max(1, (await r.json()).halfHourFee));
    }
  }
  return 2n;
}

/** May this agent's account ask the contract to sign splits for this miner? */
async function authorized(miner: string, me: string, bill: N.Bill | null): Promise<boolean> {
  if (me === miner || bill?.host === me) return true;
  const relayers: string[] = await N.view<string[]>(N.CONTRACT_ID, "get_relayers", { miner }).catch(() => []);
  return relayers.includes(me);
}

/** Payouts this miner already reserved in a signed split are skipped, not re-signed. */
async function unreserved(miner: string, inputs: B.SplitInput[]): Promise<B.SplitInput[]> {
  const held = await Promise.all(
    inputs.map((i) => N.view<string | null>(N.CONTRACT_ID, "get_outpoint", { miner, txid: i.txid, vout: i.vout }).catch(() => "unknown")),
  );
  return inputs.filter((_, i) => held[i] === null);
}

/** Bills being paid: report the 1Click swap so the host knows when to confirm paid. */
async function watchSwap(miner: string, bill: N.Bill | null) {
  if (network !== "mainnet" || bill?.status !== "Paying" || !bill.quote) return;
  const st = await O.swapStatus(bill.quote.deposit_address).catch(() => null);
  if (st) log(miner, "swap", { bill: bill.id, status: st.status, note: st.status === "SUCCESS" ? "USDC delivered. The host can confirm paid." : undefined });
}

async function tick(miner: string, me: string) {
  const m = await N.getMiner(miner);
  if (!m) return log(miner, "skip", { reason: "not registered with Rigbill" });
  const bill = await N.getOpenBill(miner);
  if (!(await authorized(miner, me, bill))) {
    return log(miner, "skip", { reason: `${me} isn't an approved relayer for this miner. The miner can add it under Approved relayers.` });
  }
  await watchSwap(miner, bill);
  const key = await payoutKey(miner);
  const address = B.payoutAddress(key);
  const inputs = await unreserved(miner, await spendable(address));
  const d = decide({ inputs, bill, coldAddress: m.cold_address, feeCap: BigInt(m.fee_cap_sats), rate: await feeRate(), nowMs: Date.now() });
  if (d.action !== "split") return log(miner, d.action, { address, reason: d.reason });

  log(miner, "split", {
    address,
    inputs: d.inputs.map((i) => `${i.txid}:${i.vout}`),
    toHost: d.hostValue,
    toCold: d.outputs[d.outputs.length - 1].value,
    fee: d.fee,
    bill: bill?.id ?? null,
    dryRun,
  });
  if (dryRun) return;
  const r = await signAndSend(miner, key, d.inputs, d.outputs, bill, { broadcast: true });
  if (r.refused) return log(miner, "refused", { code: r.code, nearTx: `${NEARBLOCKS_WEB}/txns/${r.nearTx}` });
  log(miner, "sent", { splitId: r.splitId, txid: r.txid, mempool: `${MEMPOOL_WEB}/tx/${r.txid}`, nearTx: `${NEARBLOCKS_WEB}/txns/${r.nearTx}` });
}

async function main() {
  if (miners.length === 0) {
    console.error("Usage: npm run agent -- <miner.near> [more miners] [--interval 60] [--once] [--dry-run] [--fee-rate N]");
    process.exit(2);
  }
  const me = process.env.RELAYER_ACCOUNT_ID;
  if (!me) throw new Error("Set RELAYER_ACCOUNT_ID and RELAYER_PRIVATE_KEY (see .env.example)");
  log("-", "start", { miners, intervalS, dryRun, contract: N.CONTRACT_ID, relayer: me });
  for (;;) {
    for (const miner of miners) {
      // One miner's error never stops the others.
      await tick(miner, me).catch((e) => log(miner, "error", { message: e instanceof Error ? e.message : String(e) }));
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, intervalS * 1000));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
