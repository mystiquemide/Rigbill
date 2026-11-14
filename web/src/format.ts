export type Load<T> = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; data: T };

export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const sats = (n: number) => n.toLocaleString("en-US") + " sats";
export const usd = (cents: number) => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fromNs = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n));
export const toNs = (d: Date) => (BigInt(d.getTime()) * 1_000_000n).toString();
export const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
export const fmtTime = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Contract panics come back as "Smart contract panicked: CODE". Map codes to the rule they enforce. */
const RULES: Record<string, string> = {
  QUOTE_OVER_CEILING: "This quote costs more sats than the miner agreed to. Get a new quote when the BTC price moves back.",
  QUOTE_EXPIRED: "That quote expired. Get a new quote and lock it.",
  BILL_ALREADY_OPEN: "You already have an open bill. It needs to be paid or expire before you accept another.",
  BAD_BILL_STATE: "This bill changed since the page loaded. Refresh to see where it is now.",
  NOT_HOST: "Only the host who issued this bill can do that. Sign in with that account.",
  NOT_MINER: "Only the billed miner can do that. Sign in with that account.",
  MINER_KEY_PENDING: "Your payout address is still being derived by NEAR's MPC network. Save your settings again to retry, then try once it shows.",
  MINER_NOT_REGISTERED: "That miner hasn't set up Rigbill yet. Ask them to sign in and create a payout address, then issue the bill.",
  BAD_ADDRESS: "That isn't a native segwit address for this network. Use one that starts with bc1 and try again.",
  BAD_DUE_DATE: "Pick a due date in the future.",
  BILL_OPEN_HOST_OUTPUT_REQUIRED: "A bill is open, so this payout has to pay it first. Nothing was sent.",
  OUTPUT_NOT_ALLOWED: "A split can only pay the approved deposit address and your cold wallet. Nothing was sent.",
  OUTPUT_AMOUNT_MISMATCH: "The host's share has to match the locked quote exactly. Nothing was sent.",
  NOT_AUTHORIZED: "Only the miner, the bill's host or a relayer the miner approved can request a split.",
  BAD_SPLIT_STATE: "Only a signed split can be released.",
  QUOTE_STILL_LIVE: "The bill's quote is still valid, so this payment may already be with 1Click. You can release it after the quote expires.",
  BILL_ALREADY_PAID: "That split paid a bill, so it can't be released.",
  TOO_MANY_RELAYERS: "A miner can approve at most three relayers.",
  OUTPOINT_ALREADY_SIGNED: "One of these coins was already signed for in another split. Nothing was sent.",
  FEE_OVER_CAP: "Bitcoin fees are above your fee cap. Raise the cap in Settings or wait for fees to drop.",
  DUST_OUTPUT: "One output would be too small for Bitcoin to relay (under 546 sats). Wait for a bigger payout.",
};

export function explain(e: unknown): string {
  const m = msg(e);
  const code = Object.keys(RULES).find((c) => m.includes(c));
  return code ? RULES[code] : m;
}

/** The contract code behind an error, shown small for support. */
export function errorCode(e: unknown): string | null {
  const m = msg(e);
  return Object.keys(RULES).find((c) => m.includes(c)) ?? null;
}
