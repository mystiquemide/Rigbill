import { NEARBLOCKS_WEB } from "./config";
import { errorCode, explain } from "./format";
import type { BillStatus } from "./near";
import { ContractRefusal } from "./wallet";

const LABELS: Record<BillStatus, string> = {
  Issued: "Waiting for miner",
  Accepted: "Needs a quote",
  QuoteApproved: "Quote locked",
  Paying: "Paying",
  Paid: "Paid",
  Expired: "Expired",
  Withdrawn: "Withdrawn",
};

export function StatusTag({ status }: { status: BillStatus }) {
  return <span className={`tag tag-${status.toLowerCase()}`}>{LABELS[status]}</span>;
}

const NETWORK_HINT = "Couldn't reach the network right now. Your funds aren't affected. Check your connection and try again.";

/** A failed read. Plain words first; the raw error stays behind Details for support. */
export function ErrorBox({ what, error, message, retry }: { what: string; error?: string; message?: string; retry?: () => void }) {
  return (
    <section className="card error" role="alert">
      <strong>{what}</strong>
      <p>{message ?? NETWORK_HINT}</p>
      {error && (
        <details className="error-details">
          <summary>Details</summary>
          <p className="mono small">{error}</p>
        </details>
      )}
      {retry && <button className="btn-dark" onClick={retry}>Try again</button>}
    </section>
  );
}

/** A refresh failed but earlier data is still on screen: say so, and offer a retry. */
export function StaleNote({ error, retry }: { error: string; retry: () => void }) {
  return (
    <p className="note" role="status">
      <span>Couldn't refresh just now, so this shows what was last read. <button className="link-btn" onClick={retry}>Try again</button></span>
      <span className="sr-only">{error}</span>
    </p>
  );
}

/** Loading placeholder: grey lines where content will appear, with the same words for screen readers. */
export function Skeleton({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div className="skel" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skel-line" aria-hidden="true" style={{ width: `${[92, 76, 58, 84][i % 4]}%` }} />
      ))}
      <span className="skel-label" aria-hidden="true">{label}</span>
    </div>
  );
}

/** A failed action: the rule it hit, plus a nearblocks link when the contract refused on chain. */
export function ErrorNote({ error }: { error: unknown }) {
  return (
    <p className="err" role="alert">
      {explain(error)}
      {errorCode(error) && <span className="err-code"> {errorCode(error)}</span>}
      {error instanceof ContractRefusal && error.hash && (
        <>
          {" "}
          <a href={`${NEARBLOCKS_WEB}/txns/${error.hash}`} target="_blank" rel="noreferrer">View on nearblocks</a>
        </>
      )}
    </p>
  );
}
