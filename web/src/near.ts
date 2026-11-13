import { CONTRACT_ID, NEAR_RPC, SIGNER_ID } from "./config";

export interface Miner {
  cold_address: string;
  fee_cap_sats: string;
  payout_pubkey: string | null;
}

/** Read-only contract call through public RPC. No wallet needed. */
export async function view<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "rigbill",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  if (!res.ok) throw new Error(`NEAR RPC ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error?.cause?.name ?? body.error?.message ?? "NEAR RPC error");
  if (body.result?.error) throw new Error(body.result.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)));
}

export const getMiner = (miner: string) => view<Miner | null>(CONTRACT_ID, "get_miner", { miner });

/** FR-002: the payout key comes from the MPC contract, derived for this contract and miner. */
export const derivedPublicKey = (miner: string) =>
  view<string>(SIGNER_ID, "derived_public_key", { path: `miner/${miner}`, predecessor: CONTRACT_ID, domain_id: 0 });

export type BillStatus = "Issued" | "Accepted" | "QuoteApproved" | "Paying" | "Paid" | "Expired" | "Withdrawn";

export interface Bill {
  id: string;
  host: string;
  miner: string;
  usd_cents: string;
  period: string;
  due_ns: string;
  host_address: string;
  status: BillStatus;
  ceiling_sats: string | null;
  quote: { deposit_address: string; amount_in_sats: string; deadline_ns: string } | null;
  split_id: string | null;
  created_ns: string;
}

export const getBillsForMiner = (miner: string) => view<Bill[]>(CONTRACT_ID, "get_bills_for_miner", { miner });
export const getBillsForHost = (host: string) => view<Bill[]>(CONTRACT_ID, "get_bills_for_host", { host });

export interface Split {
  miner: string;
  txid: string;
  outputs: { address: string; value: string }[];
  status: "Requested" | "Signed" | "Failed";
  bill_id: string | null;
}

export const getSplit = (id: string) => view<Split | null>(CONTRACT_ID, "get_split", { split_id: id });

export const getOpenBill = (miner: string) => view<Bill | null>(CONTRACT_ID, "get_open_bill", { miner });

export interface TxResult {
  ok: boolean;
  /** Contract error text, e.g. "Smart contract panicked: OUTPUT_NOT_ALLOWED". */
  failure: string | null;
}

/** Final status of a NEAR transaction, read from RPC rather than trusted from the wallet. */
export async function txResult(hash: string, sender: string): Promise<TxResult> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "rigbill", method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error?.cause?.name ?? "NEAR RPC error");
  const outcomes = [body.result.transaction_outcome, ...body.result.receipts_outcome];
  for (const o of outcomes) {
    const f = o?.outcome?.status?.Failure;
    if (f) {
      const exec = f?.ActionError?.kind?.FunctionCallError?.ExecutionError;
      return { ok: false, failure: exec ? String(exec) : JSON.stringify(f) };
    }
  }
  return { ok: true, failure: null };
}

export const getBill = (id: string) => view<Bill | null>(CONTRACT_ID, "get_bill", { bill_id: id });

/** After a transaction, public RPC nodes can lag a block behind. Re-read until the bill changes. */
export async function refetchBillUntilChanged(id: string, before: Bill["status"] | undefined, tries = 8): Promise<Bill | null> {
  let b: Bill | null = null;
  for (let i = 0; i < tries; i++) {
    b = await getBill(id);
    if (!b || b.status !== before) return b;
    await new Promise((r) => setTimeout(r, 1250));
  }
  return b;
}
