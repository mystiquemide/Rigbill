import { fmtDate, fromNs, sats } from "./format";
import type { Bill } from "./near";

const ORDER = ["Issued", "Accepted", "QuoteApproved", "Paying", "Paid"] as const;

/** The bill's real lifecycle, worded for whoever is looking at it. */
export function Lifecycle({ bill, side }: { bill: Bill; side: "miner" | "host" }) {
  const reached = ORDER.indexOf(bill.status as (typeof ORDER)[number]);
  const miner = side === "miner";
  const steps: [string, string | null][] = [
    [miner ? `Issued by ${bill.host}` : "Issued by you", `Created ${fmtDate(fromNs(bill.created_ns))}`],
    [miner ? "Accepted by you" : "Accepted by the miner", bill.ceiling_sats ? `Ceiling ${sats(Number(bill.ceiling_sats))}` : null],
    [miner ? "Quote locked by your host" : "Quote locked by you", bill.quote ? sats(Number(bill.quote.amount_in_sats)) : null],
    [miner ? "Paying from your next payout" : "Paying from the miner's next payout", null],
    [miner ? "Paid, confirmed by your host" : "Paid, confirmed by you", null],
  ];
  const ended = bill.status === "Expired" || bill.status === "Withdrawn";
  return (
    <section className="panel lifecycle" aria-labelledby="life-title">
      <p className="kicker" id="life-title">Lifecycle</p>
      <ol>
        {steps.map(([label, detail], i) => {
          const done = !ended && reached >= i;
          const current = !ended && reached + 1 === i;
          return (
            <li key={label} className={done ? "done" : current ? "current" : ""} aria-current={current ? "step" : undefined}>
              <span className="box" aria-hidden="true" />
              <span>{label}</span>
              {done && detail && <span className="mono muted">{detail}</span>}
            </li>
          );
        })}
      </ol>
      {bill.status === "Expired" && <p className="note">This bill passed its due date plus 7 days without being paid, so it no longer holds any payouts.</p>}
      {bill.status === "Withdrawn" && <p className="note">The host withdrew this bill before it was accepted. Nothing changed for the miner.</p>}
    </section>
  );
}
