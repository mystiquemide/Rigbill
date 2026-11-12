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
