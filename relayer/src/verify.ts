/**
 * Read-only proof check (FR-015). Needs no keys or .env. Everything is read
 * live from NEAR RPC and a public Bitcoin Esplora API, then checked:
 *
 *  1. The contract is deployed and points at the MPC signer.
 *  2. The miner's payout address comes from v1.signer's derived key, and the
 *     contract stored that same key.
 *  3. Every split the contract signed matches the Bitcoin transaction on chain:
 *     same txid, spends the payout address, outputs exactly as signed.
 *  4. Every bill that was paid was paid by a split with the approved quote.
 *  5. Each recorded refusal failed on chain with its error code and never
 *     reached the MPC signer.
 */
import { readFileSync } from "node:fs";
import { base58, hex } from "@scure/base";
import * as B from "./btc.js";
import { NETWORK as NETWORK_MAINNET } from "@scure/btc-signer";
import { ESPLORA_URLS, MEMPOOL_WEB, NEARBLOCKS_WEB, NEAR_RPC_URL, network } from "./config.js";
import * as N from "./near.js";

interface Proof {
  network: string;
  contract: string;
  miner: string;
  refusals: { tx: string; sender: string; attempt: string; expect: string }[];
}

const proofPath = new URL(`../../proof/${network}.json`, import.meta.url);
const proof: Proof = JSON.parse(readFileSync(proofPath, "utf8"));
if (proof.contract !== N.CONTRACT_ID) {
  throw new Error(`proof/${network}.json is for ${proof.contract}, but this run targets ${N.CONTRACT_ID}`);
}

let failures = 0;
const ok = (label: string, detail = "") => console.log(`  PASS  ${label}${detail ? `  ${detail}` : ""}`);
const bad = (label: string, detail = "") => {
  failures++;
  console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
};
const check = (cond: boolean, label: string, detail = "") => (cond ? ok(label, detail) : bad(label, detail));

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await fetch(NEAR_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "verify", method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error.cause ?? body.error));
  return body.result;
}

async function esplora(path: string): Promise<any> {
  let last: unknown;
  for (const base of ESPLORA_URLS) {
    try {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) return res.json();
      last = new Error(`${base} ${res.status}`);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function main() {
  console.log(`Rigbill proof check on ${network}`);
  console.log(`  contract ${N.CONTRACT_ID}  rpc ${NEAR_RPC_URL}  bitcoin ${ESPLORA_URLS[0]}\n`);

  console.log("1. Contract");
  const acct = await rpc("query", { request_type: "view_account", finality: "final", account_id: N.CONTRACT_ID });
  check(acct.code_hash !== "11111111111111111111111111111111", "contract code deployed", `code_hash ${acct.code_hash}`);
  const signer = await N.view<string>(N.CONTRACT_ID, "get_signer", {});
  check(signer === N.SIGNER_ID, "signs through the NEAR MPC network", signer);
  const keys = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: N.CONTRACT_ID });
  console.log(`  info  ${keys.keys.length} access key(s) on the contract account (code upgrades are possible, see README)`);

  console.log("\n2. Payout address");
  const miner = proof.miner;
  const m = await N.getMiner(miner);
  if (!m) return bad("miner registered", miner);
  const derived = await N.derivedPublicKey(miner);
  const [, data] = derived.split(":");
  const key = B.compressPubkey(base58.decode(data));
  const payout = B.payoutAddress(key);
  check(m.payout_pubkey === hex.encode(key), "contract stored the key v1.signer derives", `path miner/${miner}`);
  ok("payout address", `${payout}  ${MEMPOOL_WEB}/address/${payout}`);
  ok("cold address", m.cold_address);

  console.log("\n3. Bills and the Bitcoin transactions that paid them");
  const bills = await N.view<N.Bill[]>(N.CONTRACT_ID, "get_bills_for_miner", { miner, limit: 20 });
  if (bills.length === 0) console.log("  info  no bills");
  for (const b of [...bills].reverse()) {
    const usd = (Number(b.usd_cents) / 100).toFixed(2);
    console.log(`  bill #${b.id}  $${usd}  ${b.status}  host ${b.host}`);
    if (!b.split_id) continue;
    const sp = await N.getSplit(Number(b.split_id));
    if (!sp) {
      bad(`split ${b.split_id} exists`);
      continue;
    }
    check(sp.status === "Signed", `split #${b.split_id} signed by the MPC network`, sp.status);
    const tx = await esplora(`/tx/${sp.txid}`).catch(() => null);
    if (!tx) {
      bad(`BTC tx ${sp.txid} found on chain`);
      continue;
    }
    const spendsPayout = tx.vin.every((i: any) => i.prevout?.scriptpubkey_address === payout);
    check(spendsPayout, "every input spends the payout address", `${MEMPOOL_WEB}/tx/${sp.txid}`);
    const onChain = tx.vout.map((o: any) => `${o.scriptpubkey_address}:${o.value}`).join(",");
    const signed = sp.outputs.map((o) => `${o.address}:${o.value}`).join(",");
    check(onChain === signed, "outputs on chain are exactly what the contract signed", onChain.replace(/,/g, " + "));
    if (b.quote) {
      check(
        sp.outputs[0]?.address === b.quote.deposit_address && sp.outputs[0]?.value === b.quote.amount_in_sats,
        "first output is the approved quote",
        `${b.quote.amount_in_sats} sats to ${b.quote.deposit_address}`,
      );
      check(sp.outputs[1]?.address === m.cold_address && sp.outputs.length === 2, "the rest went to the miner's cold address");
    }
    check(tx.status.confirmed, "confirmed on Bitcoin", tx.status.confirmed ? `block ${tx.status.block_height}` : "in mempool");
  }

  console.log("\n4. Refusals (the contract's rule, enforced on chain)");
  for (const r of proof.refusals) {
    const res = await rpc("tx", { tx_hash: r.tx, sender_account_id: r.sender, wait_until: "FINAL" });
    const outcomes = [res.transaction_outcome, ...res.receipts_outcome];
    const failure = outcomes.map((o: any) => o.outcome.status?.Failure).find(Boolean);
    const text = JSON.stringify(failure ?? "");
    const reachedSigner = res.receipts_outcome.some((o: any) => o.outcome.executor_id === N.SIGNER_ID);
    check(text.includes(r.expect) && !reachedSigner, `${r.attempt}: refused with ${r.expect}, no signature requested`, `${NEARBLOCKS_WEB}/txns/${r.tx}`);
  }

  console.log("\n5. USDC leg on mainnet (dry 1Click quote, nothing is sent)");
  try {
    const refundTo = B.payoutAddress(key, NETWORK_MAINNET);
    const res = await fetch("https://1click.chaindefuser.com/v0/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dry: true, swapType: "EXACT_OUTPUT", slippageTolerance: 100,
        originAsset: "nep141:btc.omft.near", depositType: "ORIGIN_CHAIN",
        destinationAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
        amount: "6000000", refundTo, refundType: "ORIGIN_CHAIN",
        recipient: "0x1111111111111111111111111111111111111111", recipientType: "DESTINATION_CHAIN",
        deadline: new Date(Date.now() + 864e5).toISOString(),
      }),
    });
    const body: any = await res.json();
    check(res.ok && body.quote?.amountOut === "6000000", "1Click quotes BTC to exactly 6.00 USDC on Base", res.ok ? `${body.quote.amountIn} sats in` : body?.message ?? String(res.status));
    ok("refunds go to this payout key on Bitcoin mainnet", refundTo);
  } catch (e) {
    bad("1Click reachable", e instanceof Error ? e.message : String(e));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(`verify stopped: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 2;
});
