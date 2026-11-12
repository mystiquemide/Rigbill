import { Account, JsonRpcProvider, actions, teraToGas } from "near-api-js";

import { CONTRACT_ID, NEAR_RPC_URL as RPC_URL, SIGNER_ID } from "./config.js";

export { CONTRACT_ID, SIGNER_ID };

/** Must match the contract's SPLIT_STORAGE_DEPOSIT (0.01 NEAR) plus 1 yocto per input. */
const SPLIT_DEPOSIT = 10n ** 22n;

export const provider = new JsonRpcProvider({ url: RPC_URL });

export async function view<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

export interface Miner {
  cold_address: string;
  fee_cap_sats: string;
  payout_pubkey: string | null;
}

export interface Split {
  miner: string;
  txid: string;
  inputs: { txid: string; vout: number; value: string }[];
  outputs: { address: string; value: string }[];
  sighashes: string[];
  signatures: string[];
  status: "Requested" | "Signed" | "Failed";
  bill_id: string | null;
}

export interface Bill {
  id: string;
  host: string;
  miner: string;
  usd_cents: string;
  host_address: string;
  status: "Issued" | "Accepted" | "QuoteApproved" | "Paying" | "Paid" | "Expired" | "Withdrawn";
  quote: { deposit_address: string; amount_in_sats: string; deadline_ns: string } | null;
  split_id: string | null;
}

export const getOpenBill = (miner: string) => view<Bill | null>(CONTRACT_ID, "get_open_bill", { miner });
export const getBill = (id: string) => view<Bill | null>(CONTRACT_ID, "get_bill", { bill_id: id });

export const getMiner = (miner: string) => view<Miner | null>(CONTRACT_ID, "get_miner", { miner });
export const getSplit = (id: number) => view<Split | null>(CONTRACT_ID, "get_split", { split_id: String(id) });

/** The derived key exactly as `v1.signer` reports it for this miner's path. */
export async function derivedPublicKey(miner: string): Promise<string> {
  return view<string>(SIGNER_ID, "derived_public_key", {
    path: `miner/${miner}`,
    predecessor: CONTRACT_ID,
    domain_id: 0,
  });
}

export function relayerAccount(): Account {
  const id = process.env.RELAYER_ACCOUNT_ID;
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!id || !key) throw new Error("Set RELAYER_ACCOUNT_ID and RELAYER_PRIVATE_KEY (see .env.example)");
  return new Account(id, provider, key as `ed25519:${string}`);
}

export interface SignSplitResult {
  nearTxHash: string;
  splitId: number | null;
  failure: string | null;
  gasBurnt: bigint;
}

/** Contract panics come back as readable codes, e.g. OUTPUT_NOT_ALLOWED. */
function failureMessage(outcome: any): string | null {
  const f = outcome?.status?.Failure;
  if (!f) return null;
  const exec = f?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  return exec ? String(exec).replace(/^Smart contract panicked: /, "") : JSON.stringify(f);
}

export async function signSplit(
  miner: string,
  inputs: { txid: string; vout: number; value: bigint }[],
  outputs: { address: string; value: bigint }[],
): Promise<SignSplitResult> {
  const account = relayerAccount();
  // throwOnFailure: false keeps the tx hash when the contract refuses, so a
  // refusal can be linked on nearblocks like any other transaction.
  const res: any = await account.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions: [
      actions.functionCall(
        "sign_split",
        {
          miner,
          inputs: inputs.map((i) => ({ txid: i.txid, vout: i.vout, value: String(i.value) })),
          outputs: outputs.map((o) => ({ address: o.address, value: String(o.value) })),
        },
        teraToGas("300"),
        SPLIT_DEPOSIT + BigInt(inputs.length),
      ),
    ],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });

  const outcomes = [res.transaction_outcome, ...(res.receipts_outcome ?? [])];
  let splitId: number | null = null;
  let failure: string | null = null;
  let gasBurnt = 0n;
  for (const o of outcomes) {
    gasBurnt += BigInt(o?.outcome?.gas_burnt ?? 0);
    failure ??= failureMessage(o?.outcome);
    for (const log of o?.outcome?.logs ?? []) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      const ev = JSON.parse(log.slice("EVENT_JSON:".length));
      if (ev.event === "split_requested") splitId = Number(ev.data[0].split_id);
    }
  }
  return { nearTxHash: res.transaction?.hash ?? res.transaction_outcome?.id, splitId, failure, gasBurnt };
}
