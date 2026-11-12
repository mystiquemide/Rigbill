import { useCallback, useEffect, useState } from "react";
import { getBillsForMiner, type Bill } from "./near";
import { btcPriceUsd, usdToSats } from "./oneclick";
import { ErrorBox, StatusTag } from "./ui";
import { explain, fmtDate, fromNs, msg, sats, usd, type Load } from "./format";
import { callContract } from "./wallet";

/** FR-004: the miner sees bills addressed to them and accepts one with a sats ceiling. */
export function MinerBills({ account }: { account: string }) {
  const [bills, setBills] = useState<Load<Bill[]>>({ state: "loading" });
  const load = useCallback(() => {
    getBillsForMiner(account)
      .then((data) => setBills({ state: "ok", data }))
      .catch((e) => setBills({ state: "error", error: msg(e) }));
  }, [account]);
  useEffect(load, [load]);

  if (bills.state === "loading") return <section className="card muted">Loading your bills...</section>;
  if (bills.state === "error") return <ErrorBox what="Couldn't load your bills" error={bills.error} retry={load} />;
  const list = bills.data;
  const open = list.find((b) => ["Accepted", "QuoteApproved", "Paying"].includes(b.status));

  return (
    <section className="card">
      <div className="row">
        <h2>Hosting bills</h2>
        <button className="ghost" onClick={load}>Refresh</button>
      </div>
      {list.length === 0 && (
        <p className="muted">
          No bills yet. When your host issues one to <span className="mono">{account}</span>, it shows up here.
        </p>
      )}
      {open && (
        <p className="small">
          While bill #{open.id} is open, every payout split must pay it before anything reaches your cold wallet.
        </p>
      )}
      {list.map((b) => (
        <BillRow key={b.id} bill={b} canAccept={!open && b.status === "Issued"} onDone={load} />
      ))}
    </section>
  );
}

function BillRow({ bill, canAccept, onDone }: { bill: Bill; canAccept: boolean; onDone: () => void }) {
  const [ceiling, setCeiling] = useState<string>("");
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = Number(bill.usd_cents);

  useEffect(() => {
    if (!canAccept) return;
    // Pre-fill the ceiling from the live BTC price plus 5% (plan, journey step 6).
    btcPriceUsd()
      .then((p) => {
        setPrice(p);
        setCeiling((c) => c || String(Math.ceil(usdToSats(cents, p) * 1.05)));
      })
      .catch(() => setPrice(null));
  }, [canAccept, cents]);

  const accept = async () => {
    const n = Number(ceiling);
    if (!/^\d+$/.test(ceiling) || n <= 0) return setError("Enter the most sats you'll allow for this bill.");
    setBusy(true);
    setError(null);
    try {
      await callContract("accept_bill", { bill_id: bill.id, ceiling_sats: String(n) }, 0n, 30n);
      onDone();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bill">
      <div className="row">
        <div>
          <strong>{usd(cents)}</strong> <span className="muted">for {bill.period}</span>
          <div className="small muted">
            #{bill.id} from <span className="mono">{bill.host}</span>, due {fmtDate(fromNs(bill.due_ns))}
          </div>
        </div>
        <StatusTag status={bill.status} />
      </div>
      {bill.ceiling_sats && <div className="small">Your ceiling: {sats(Number(bill.ceiling_sats))}</div>}
      {bill.quote && (
        <div className="small">
          Locked quote: {sats(Number(bill.quote.amount_in_sats))} to{" "}
          <span className="mono">{bill.quote.deposit_address}</span>
        </div>
      )}
      {canAccept && (
        <div className="accept">
          <label>
            Most sats you'll allow for this bill
            <input value={ceiling} onChange={(e) => setCeiling(e.target.value)} inputMode="numeric" />
          </label>
          <p className="small muted">
            {price
              ? `At $${price.toLocaleString("en-US")} per BTC this bill is about ${sats(usdToSats(cents, price))}. `
              : ""}
            The host can't lock a quote above this. Once accepted, you can't cancel the bill. It releases when paid or 7
            days after the due date.
          </p>
          {error && <p className="err">{error}</p>}
          <button onClick={accept} disabled={busy}>
            {busy ? "Waiting for wallet..." : "Accept bill"}
          </button>
        </div>
      )}
    </div>
  );
}
