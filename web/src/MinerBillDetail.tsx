import { useCallback, useEffect, useState } from "react";
import { MEMPOOL_WEB } from "./config";
import { fmtDate, fromNs, msg, sats, usd } from "./format";
import { Lifecycle } from "./Lifecycle";
import { Link } from "./Link";
import { getBill, getOpenBill, getSplit, refetchBillUntilChanged, type Bill, type Split } from "./near";
import { btcPriceUsd, usdToSats } from "./oneclick";
import { SplitStatus } from "./SplitStatus";
import { ErrorBox, ErrorNote, Skeleton, StatusTag } from "./ui";
import { callContract } from "./wallet";

/** S5: one bill, from the miner's side. */
export default function MinerBillDetail({ account, id }: { account: string; id: string }) {
  const [bill, setBill] = useState<Bill | null | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([getBill(id), getOpenBill(account)])
      .then(([b, o]) => { setBill(b); setOpenId(o?.id ?? null); setError(null); })
      .catch((e) => setError(msg(e)));
  }, [id, account]);
  useEffect(load, [load]);

  const back = <Link to="/miner" className="back-link">Back to your payouts</Link>;
  if (error) return <>{back}<ErrorBox what={`Couldn't read bill #${id}`} error={error} retry={load} /></>;
  if (bill === undefined) return <>{back}<Skeleton label={`Reading bill #${id} from the contract…`} lines={4} /></>;
  if (bill === null || bill.miner !== account) {
    return <>{back}<section className="panel"><p className="kicker">Bill #{id}</p><p className="muted" style={{ margin: 0 }}>There is no bill #{id} addressed to {account}.</p></section></>;
  }

  const other = openId && openId !== bill.id ? openId : null;
  const afterTx = () => void refetchBillUntilChanged(id, bill.status).then(() => load()).catch((e) => setError(msg(e)));
  return (
    <div className="bill-detail">
      {back}
      <header className="bill-head">
        <div>
          <p className="kicker">Bill #{bill.id}</p>
          <h1 className="h2 bill-title">{usd(Number(bill.usd_cents))} for {bill.period}</h1>
          <p className="muted">From <span className="mono">{bill.host}</span>, due {fmtDate(fromNs(bill.due_ns))}</p>
        </div>
        {bill.status === "Issued" ? <span className="chip chip-warn">Waiting for you</span> : <StatusTag status={bill.status} />}
      </header>
      <div className="bill-grid">
        <div className="bill-main">
          {bill.status === "Issued" && (other ? <BlockedByOpen otherId={other} /> : <AcceptPanel bill={bill} onDone={afterTx} />)}
          {bill.status === "Accepted" && <Waiting text="You accepted this bill. Your host now locks a quote within your ceiling. Payouts stay at your address until then." />}
          {bill.status === "QuoteApproved" && <Waiting text={`Your host locked ${sats(Number(bill.quote!.amount_in_sats))}. Your next payout pays that to your host first and sends the rest to your wallet.`} tone="lime" />}
          {(bill.status === "Paying" || bill.status === "Paid") && <Receipt bill={bill} />}
        </div>
        <Lifecycle bill={bill} side="miner" />
      </div>
    </div>
  );
}

function BlockedByOpen({ otherId }: { otherId: string }) {
  return (
    <section className="panel">
      <h2 className="panel-title">You can't accept this yet</h2>
      <p className="note note-review">Bill #{otherId} is still open. A miner can have one open bill at a time, so this one waits until #{otherId} is paid or expires.</p>
      <p style={{ margin: "16px 0 0" }}><Link to={`/miner/bills/${otherId}`} className="arrow-link">Open bill #{otherId}</Link></p>
    </section>
  );
}

function Waiting({ text, tone = "review" }: { text: string; tone?: "review" | "lime" }) {
  return (
    <section className="panel">
      <h2 className="panel-title">What happens next</h2>
      <p className={`note note-${tone}`}>{text}</p>
    </section>
  );
}

function AcceptPanel({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const cents = Number(bill.usd_cents);
  const [price, setPrice] = useState<number | null>(null);
  const [ceiling, setCeiling] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    btcPriceUsd()
      .then((p) => { setPrice(p); setCeiling((c) => c || Math.ceil(usdToSats(cents, p) * 1.05).toLocaleString("en-US")); })
      .catch(() => setPrice(null));
  }, [cents]);

  const n = Number(ceiling.replace(/,/g, ""));
  const valid = /^\d[\d,]*$/.test(ceiling) && n > 0;
  const accept = async () => {
    if (!valid) return setError("Enter the most sats you'll allow for this bill.");
    setBusy(true);
    setError(null);
    try {
      await callContract("accept_bill", { bill_id: bill.id, ceiling_sats: String(n) }, 0n, 30n);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel accept-panel" aria-labelledby="accept-title">
      <h2 className="panel-title" id="accept-title">Accept this bill</h2>
      <p className="muted">
        {price ? `At $${price.toLocaleString("en-US")} per BTC this bill is about ${sats(usdToSats(cents, price))}. ` : "Reading today's BTC price… "}
        Set the most you'll ever let it cost. Your host can't lock a quote above it.
      </p>
      <div className="field">
        <label htmlFor="ceiling">Most sats you'll allow for this bill</label>
        <input id="ceiling" value={ceiling} onChange={(e) => setCeiling(e.target.value)} inputMode="numeric" aria-describedby="ceiling-help" />
        <p id="ceiling-help" className="help">Pre-filled at today's estimate plus 5% for price movement and the swap spread.</p>
      </div>
      <p className="note note-warn">Once accepted you can't cancel it. It releases when paid, or 7 days after the due date if it isn't.</p>
      {error != null && <ErrorNote error={error} />}
      <div className="actions"><button onClick={accept} disabled={busy || !price}>{busy ? "Waiting for your wallet…" : "Accept bill"}</button></div>
    </section>
  );
}

function Receipt({ bill }: { bill: Bill }) {
  const [split, setSplit] = useState<Split | null>(null);
  useEffect(() => {
    if (bill.split_id) getSplit(bill.split_id).then(setSplit).catch(() => setSplit(null));
  }, [bill.split_id]);
  const [host, cold] = split?.outputs ?? [];
  return (
    <section className="panel" aria-labelledby="receipt-title">
      <h2 className="panel-title" id="receipt-title">{bill.status === "Paid" ? "Paid from your payout" : "Paying from your payout"}</h2>
      {!split && <Skeleton label="Reading the split from the contract…" lines={2} />}
      {split && (
        <dl className="kv-list">
          {host && <div className="kv"><dt>To your host</dt><dd className="num">{sats(Number(host.value))}</dd></div>}
          {cold && <div className="kv"><dt>To your wallet</dt><dd className="num">{sats(Number(cold.value))}</dd></div>}
          <div className="kv"><dt>Bitcoin split</dt><dd className="num"><a href={`${MEMPOOL_WEB}/tx/${split.txid}`} target="_blank" rel="noreferrer">{split.txid}</a></dd></div>
        </dl>
      )}
      <div style={{ marginTop: 16 }}><SplitStatus bill={bill} /></div>
    </section>
  );
}
