import type { BillStatus } from "./near";

const LABELS: Record<BillStatus, string> = {
  Issued: "Waiting for miner",
  Accepted: "Accepted, needs quote",
  QuoteApproved: "Quote locked, waiting for payout",
  Paying: "Paying",
  Paid: "Paid",
  Expired: "Expired",
  Withdrawn: "Withdrawn",
};

export function StatusTag({ status }: { status: BillStatus }) {
  return <span className={`tag tag-${status.toLowerCase()}`}>{LABELS[status]}</span>;
}

export function ErrorBox({ what, error, retry }: { what: string; error: string; retry?: () => void }) {
  return (
    <section className="card error">
      <strong>{what}</strong>
      <p className="mono small">{error}</p>
      {retry && <button className="ghost" onClick={retry}>Try again</button>}
    </section>
  );
}
