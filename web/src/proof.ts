import proofTestnet from "../../proof/testnet.json";
import proofMainnet from "../../proof/mainnet.json";
import { payoutFromDerivedKey } from "./btc";
import { CONTRACT_ID, ESPLORA, MEMPOOL_WEB, NEARBLOCKS_WEB, NEAR_RPC, SIGNER_ID, network } from "./config";
import { getMiner, view, type Bill, type Split } from "./near";
import { mainnetQuoteCheck, swapStatus } from "./oneclick";

/**
 * The browser twin of `npm run verify`. Every check reads NEAR RPC and a public
 * Bitcoin Esplora API live; nothing here is cached or written by hand.
 */
interface ProofFile {
  network: string;
  contract: string;
  miner: string;
  refusals: { tx: string; sender: string; attempt: string; expect: string }[];
}

const PROOFS: Record<string, ProofFile | undefined> = { testnet: proofTestnet, mainnet: proofMainnet };
export const proofFile: ProofFile | null = PROOFS[network]?.contract === CONTRACT_ID ? PROOFS[network]! : null;

export interface Check {
  group: "Contract" | "Payout address" | "Bills" | "Refusals" | "1Click";
  label: string;
  detail: string;
  ok: boolean;
  href?: string;
}

/** The miner's most recent paid bill and the Bitcoin split that paid it. */
export interface PaidBill {
  bill: Bill;
  split: Split;
  txid: string;
  confirmedHeight: number | null;
  fee: number | null;
  /** The payout address, derived from the MPC key the contract stored. */
  address: string;
}

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await fetch(NEAR_RPC, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "proof", method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error?.cause?.name ?? "NEAR RPC error");
  return body.result;
}

async function btcTx(txid: string): Promise<any | null> {
  const res = await fetch(`${ESPLORA}/tx/${txid}`, { signal: AbortSignal.timeout(15000) });
  return res.ok ? res.json() : null;
}

export async function latestPaidBill(miner: string): Promise<PaidBill | null> {
  const bills = await view<Bill[]>(CONTRACT_ID, "get_bills_for_miner", { miner, limit: 20 });
  const bill = bills.find((b) => b.status === "Paid" && b.split_id);
  if (!bill) return null;
  const split = await view<Split | null>(CONTRACT_ID, "get_split", { split_id: bill.split_id });
  if (!split) return null;
  const [tx, derived] = await Promise.all([
    btcTx(split.txid),
    view<string>(SIGNER_ID, "derived_public_key", { path: `miner/${miner}`, predecessor: CONTRACT_ID, domain_id: 0 }),
  ]);
  return { bill, split, txid: split.txid, confirmedHeight: tx?.status?.confirmed ? tx.status.block_height : null, fee: tx?.fee ?? null, address: payoutFromDerivedKey(derived).address };
}

export async function runChecks(onProgress?: (done: Check[]) => void): Promise<Check[]> {
  if (!proofFile) throw new Error(`No recorded proof for ${CONTRACT_ID} on ${network} yet.`);
  const out: Check[] = [];
  const push = (c: Check) => {
    out.push(c);
    onProgress?.([...out]);
  };

  const acct = await rpc("query", { request_type: "view_account", finality: "final", account_id: CONTRACT_ID });
  push({ group: "Contract", label: "Contract code deployed", detail: `code_hash ${acct.code_hash.slice(0, 8)}…`, ok: acct.code_hash !== "11111111111111111111111111111111", href: `${NEARBLOCKS_WEB}/address/${CONTRACT_ID}` });
  const signer = await view<string>(CONTRACT_ID, "get_signer", {});
  push({ group: "Contract", label: "Signs through the NEAR MPC network", detail: signer, ok: signer === SIGNER_ID });

  const miner = proofFile.miner;
  const m = await getMiner(miner);
  const derived = await view<string>(SIGNER_ID, "derived_public_key", { path: `miner/${miner}`, predecessor: CONTRACT_ID, domain_id: 0 });
  const payout = payoutFromDerivedKey(derived);
  push({ group: "Payout address", label: "Contract stored the key v1.signer derives", detail: `path miner/${miner}`, ok: m?.payout_pubkey === payout.pubkey });
  push({ group: "Payout address", label: "Payout address", detail: payout.address, ok: true, href: `${MEMPOOL_WEB}/address/${payout.address}` });

  // These don't depend on each other, so start them now and read them in order.
  const refusalTxs = proofFile.refusals.map((r) => rpc("tx", { tx_hash: r.tx, sender_account_id: r.sender, wait_until: "FINAL" }));
  refusalTxs.forEach((t) => t.catch(() => {}));
  const quote = mainnetQuoteCheck(payout.pubkey).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

  const bills = await view<Bill[]>(CONTRACT_ID, "get_bills_for_miner", { miner, limit: 20 });
  for (const b of [...bills].reverse().filter((x) => x.split_id)) {
    const split = await view<Split | null>(CONTRACT_ID, "get_split", { split_id: b.split_id });
    if (!split) continue;
    const tx = await btcTx(split.txid);
    const href = `${MEMPOOL_WEB}/tx/${split.txid}`;
    push({ group: "Bills", label: `Split #${b.split_id} signed by the MPC network`, detail: split.status, ok: split.status === "Signed" });
    const spendsPayout = !!tx && tx.vin.every((i: any) => i.prevout?.scriptpubkey_address === payout.address);
    push({ group: "Bills", label: "Every input spends the payout address", detail: `${split.txid.slice(0, 8)}…`, ok: spendsPayout, href });
    const onChain = tx ? tx.vout.map((o: any) => `${o.scriptpubkey_address}:${o.value}`).join(",") : "";
    const signed = split.outputs.map((o) => `${o.address}:${o.value}`).join(",");
    push({ group: "Bills", label: "Outputs on chain are exactly what the contract signed", detail: split.outputs.map((o) => Number(o.value).toLocaleString("en-US")).join(" + ") + " sats", ok: onChain === signed, href });
    if (b.quote) {
      const first = split.outputs[0];
      push({ group: "Bills", label: "First output is the approved quote", detail: `${Number(b.quote.amount_in_sats).toLocaleString("en-US")} sats`, ok: first?.address === b.quote.deposit_address && first?.value === b.quote.amount_in_sats });
    }
    if (network === "mainnet" && b.quote && b.status === "Paid") {
      const st = await swapStatus(b.quote.deposit_address).catch(() => null);
      const out = st?.swapDetails?.destinationChainTxHashes?.[0]?.hash;
      push({ group: "Bills", label: "1Click swapped it and delivered USDC on Base", detail: st?.status ?? "unreachable", ok: st?.status === "SUCCESS", href: out ? `https://basescan.org/tx/${out}` : undefined });
    }
    push({ group: "Bills", label: "Confirmed on Bitcoin", detail: tx?.status?.confirmed ? `block ${tx.status.block_height.toLocaleString("en-US")}` : "in mempool", ok: !!tx?.status?.confirmed, href });
  }

  for (const [i, r] of proofFile.refusals.entries()) {
    const res = await refusalTxs[i];
    const outcomes = [res.transaction_outcome, ...res.receipts_outcome];
    const failure = JSON.stringify(outcomes.map((o: any) => o.outcome.status?.Failure).find(Boolean) ?? "");
    const reachedSigner = res.receipts_outcome.some((o: any) => o.outcome.executor_id === SIGNER_ID);
    push({ group: "Refusals", label: r.attempt, detail: r.expect, ok: failure.includes(r.expect) && !reachedSigner, href: `${NEARBLOCKS_WEB}/txns/${r.tx}` });
  }
  const q = await quote;
  if ("error" in q) push({ group: "1Click", label: "Live 1Click quote for a $10 bill", detail: q.error, ok: false });
  else {
    push({ group: "1Click", label: "1Click quotes BTC to exactly 10.00 USDC on Base", detail: `${Number(q.amountIn).toLocaleString("en-US")} sats in, ${q.amountOutFormatted} USDC out`, ok: q.amountOut === "10000000" });
    push({ group: "1Click", label: "Refunds go to this payout key on Bitcoin mainnet", detail: q.refundTo, ok: true });
  }
  return out;
}
