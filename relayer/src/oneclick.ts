/** NEAR Intents 1Click API (mainnet only, Intents has no testnet). */
const API = process.env.ONECLICK_URL || "https://1click.chaindefuser.com/v0";

export type SwapStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export interface StatusResponse {
  status: SwapStatus;
  updatedAt?: string;
  swapDetails?: {
    originChainTxHashes?: { hash: string; explorerUrl?: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl?: string }[];
    amountOutFormatted?: string;
    refundedAmount?: string;
  };
}

/** Tells 1Click which BTC tx funds the deposit address, so it doesn't wait to discover it. */
export async function submitDeposit(txHash: string, depositAddress: string): Promise<unknown> {
  const res = await fetch(`${API}/deposit/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHash, depositAddress }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`1Click deposit/submit ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

export async function swapStatus(depositAddress: string): Promise<StatusResponse> {
  const res = await fetch(`${API}/status?depositAddress=${encodeURIComponent(depositAddress)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`1Click status ${res.status}: ${JSON.stringify(body)}`);
  return body as StatusResponse;
}
