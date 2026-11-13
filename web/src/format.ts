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
  QUOTE_OVER_CEILING: "Refused: the quote needs more sats than the miner's ceiling allows.",
  QUOTE_EXPIRED: "Refused: that quote's deadline has already passed.",
  BILL_ALREADY_OPEN: "Refused: you already have an open bill. It must be paid or expire first.",
  BAD_BILL_STATE: "Refused: the bill isn't in a state that allows this.",
  NOT_HOST: "Refused: only the host who issued this bill can do that.",
  NOT_MINER: "Refused: only the billed miner can do that.",
  MINER_NOT_REGISTERED: "Refused: that account hasn't set up Rigbill yet.",
  BAD_ADDRESS: "Refused: the contract rejected that address.",
  BAD_DUE_DATE: "Refused: the due date must be in the future.",
  BILL_OPEN_HOST_OUTPUT_REQUIRED: "Refused: a bill is open, so this payout must pay it first.",
  OUTPUT_NOT_ALLOWED: "Refused: the split can only pay the approved deposit address and your cold wallet.",
  OUTPUT_AMOUNT_MISMATCH: "Refused: the host output must be exactly the approved quote amount.",
  OUTPOINT_ALREADY_SIGNED: "Refused: one of these coins was already signed for in another split.",
  FEE_OVER_CAP: "Refused: the network fee is above the miner's fee cap.",
  DUST_OUTPUT: "Refused: an output would be below Bitcoin's dust limit.",
};

export function explain(e: unknown): string {
  const m = msg(e);
  const code = Object.keys(RULES).find((c) => m.includes(c));
  return code ? `${RULES[code]} (${code})` : m;
}
