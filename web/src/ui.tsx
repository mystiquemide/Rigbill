import { NEARBLOCKS_WEB } from "./config";
import { explain } from "./format";
import type { BillStatus } from "./near";
import { ContractRefusal } from "./wallet";

const LABELS: Record<BillStatus, string> = {
  Issued: "Waiting for miner",
  Accepted: "Accepted, needs quote",
  QuoteApproved: "Quote locked",
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

/** A failed action: the rule it hit, plus a nearblocks link when the contract refused on chain. */
export function ErrorNote({ error }: { error: unknown }) {
  return (
    <p className="err">
      {explain(error)}
      {error instanceof ContractRefusal && error.hash && (
        <>
          {" "}
          <a href={`${NEARBLOCKS_WEB}/txns/${error.hash}`} target="_blank" rel="noreferrer">View on nearblocks</a>
        </>
      )}
    </p>
  );
}
