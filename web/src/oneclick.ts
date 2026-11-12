/** NEAR Intents 1Click API. Mainnet only: Intents has no testnet. */
const API = "https://1click.chaindefuser.com/v0";
export const BTC_ASSET = "nep141:btc.omft.near";
export const BASE_USDC_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
/** 1Click's BTC minimum on 2026-11-12. Re-checked live through dry quotes. */
export const ONECLICK_MIN_SATS = 8300;

export interface Quote {
  depositAddress?: string;
  amountIn: string;
  minAmountIn: string;
  amountOut: string;
  deadline?: string;
  timeEstimate: number;
}

/** Live BTC price in USD from 1Click's token list. */
export async function btcPriceUsd(): Promise<number> {
  const res = await fetch(`${API}/tokens`);
  if (!res.ok) throw new Error(`1Click tokens ${res.status}`);
  const tokens: { assetId: string; price: number }[] = await res.json();
  const btc = tokens.find((t) => t.assetId === BTC_ASSET);
  if (!btc?.price) throw new Error("1Click has no BTC price");
  return btc.price;
}

export function usdToSats(usdCents: number, priceUsd: number): number {
  return Math.ceil((usdCents / 100 / priceUsd) * 1e8);
}

/**
 * EXACT_OUTPUT quote: the host receives exactly the bill in USDC on Base.
 * Refunds go to the miner's payout address (BR-005).
 */
export async function quoteBillInBtc(p: {
  dry: boolean;
  usdCents: number;
  recipient: string;
  refundTo: string;
  deadline: Date;
}): Promise<Quote> {
  const res = await fetch(`${API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: p.dry,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: BTC_ASSET,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: BASE_USDC_ASSET,
      amount: String(p.usdCents * 10_000), // USDC has 6 decimals
      refundTo: p.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: p.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: p.deadline.toISOString(),
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.quote) throw new Error(body?.message ?? `1Click quote ${res.status}`);
  return body.quote;
}

export type SwapStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export interface SwapStatusResponse {
  status: SwapStatus;
  swapDetails?: { destinationChainTxHashes?: { hash: string; explorerUrl?: string }[] };
}

export async function swapStatus(depositAddress: string): Promise<SwapStatusResponse> {
  const res = await fetch(`${API}/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `1Click status ${res.status}`);
  return body;
}
