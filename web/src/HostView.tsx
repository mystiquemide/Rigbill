import { useCallback, useEffect, useState } from "react";
import { coldAddressError, payoutFromDerivedKey } from "./btc";
import { BILL_STORAGE_DEPOSIT, network } from "./config";
import { derivedPublicKey, getBillsForHost, getMiner, type Bill } from "./near";
import { ONECLICK_MIN_SATS, btcPriceUsd, quoteBillInBtc, usdToSats, type Quote } from "./oneclick";
import { ErrorBox, StatusTag } from "./ui";
import { explain, fmtDate, fmtTime, fromNs, msg, sats, toNs, usd, type Load } from "./format";
import { callContract } from "./wallet";
import { SplitStatus } from "./SplitStatus";

const QUOTE_TTL_DAYS = 3;
const isEvm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

/** Host view: issue bills (FR-003) and lock a 1Click quote for accepted ones (FR-005). */
export function HostView({ account }: { account: string }) {
  const [bills, setBills] = useState<Load<Bill[]>>({ state: "loading" });
  const load = useCallback(() => {
    getBillsForHost(account)
      .then((data) => setBills({ state: "ok", data }))
      .catch((e) => setBills({ state: "error", error: msg(e) }));
  }, [account]);
  useEffect(load, [load]);

  return (
    <>
      <IssueForm onDone={load} />
      {bills.state === "loading" && <section className="card muted">Loading your bills...</section>}
      {bills.state === "error" && <ErrorBox what="Couldn't load your bills" error={bills.error} retry={load} />}
      {bills.state === "ok" && (
        <section className="card">
          <div className="row">
            <h2>Bills you issued</h2>
            <button className="ghost" onClick={load}>Refresh</button>
          </div>
          {bills.data.length === 0 && <p className="muted">None yet. Issue one above.</p>}
          {bills.data.map((b) => (
            <HostBill key={b.id} bill={b} onDone={load} />
          ))}
        </section>
      )}
    </>
  );
}

function IssueForm({ onDone }: { onDone: () => void }) {
  const [miner, setMiner] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(() => new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }) + " hosting");
  const [due, setDue] = useState(() => new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  const [addr, setAddr] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    btcPriceUsd().then(setPrice).catch(() => setPrice(null));
  }, []);

  const cents = Math.round(Number(amount) * 100);
  const [now] = useState(() => Date.now());
  const dueDate = new Date(due + "T23:59:59");
  const errs = {
    miner: /^[a-z0-9._-]{2,64}$/.test(miner.trim()) ? null : "Enter the miner's NEAR account.",
    amount: Number.isFinite(cents) && cents > 0 ? null : "Enter the bill amount in USD.",
    period: period.trim() && period.length <= 64 ? null : "Describe the period in up to 64 characters.",
    due: dueDate.getTime() > now ? null : "The due date must be in the future.",
    addr: isEvm(addr) ? null : "Enter the Base address that receives USDC (0x followed by 40 hex characters).",
  };
  const estSats = price && cents > 0 ? usdToSats(cents, price) : null;
  const belowMin = estSats !== null && estSats < ONECLICK_MIN_SATS;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await getMiner(miner.trim()))) throw new Error("MINER_NOT_REGISTERED");
      await callContract(
        "issue_bill",
        { miner: miner.trim(), usd_cents: String(cents), period: period.trim(), due_ns: toNs(dueDate), host_address: addr.trim() },
        BILL_STORAGE_DEPOSIT,
        30n,
      );
      setMiner("");
      setAmount("");
      setTouched(false);
      onDone();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const show = (k: keyof typeof errs) => touched && errs[k] && <p className="err">{errs[k]}</p>;
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>Issue a bill</h2>
      <label>Miner's NEAR account<input value={miner} onChange={(e) => setMiner(e.target.value)} placeholder={network === "testnet" ? "miner.testnet" : "miner.near"} spellCheck={false} /></label>
      {show("miner")}
      <label>Amount (USD)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="150.00" /></label>
      {show("amount")}
      {estSats !== null && (
        <p className={belowMin ? "warn small" : "small muted"}>
          About {sats(estSats)} at today's price.
          {belowMin && ` That's under 1Click's ${sats(ONECLICK_MIN_SATS)} minimum, so a quote for it can't be approved.`}
        </p>
      )}
      <label>Period<input value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
      {show("period")}
      <label>Due date<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      {show("due")}
      <label>Your Base address for USDC<input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x..." spellCheck={false} /></label>
      {show("addr")}
      <p className="small muted">Issuing locks 0.01 NEAR for storage. The bill does nothing until the miner accepts it.</p>
      {error && <p className="err">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Waiting for wallet..." : "Issue bill"}</button>
    </form>
  );
}

function HostBill({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const quoteExpired = bill.quote && fromNs(bill.quote.deadline_ns).getTime() <= now;
  const needsQuote = bill.status === "Accepted" || (bill.status === "QuoteApproved" && quoteExpired);

  const act = (method: "withdraw_bill" | "confirm_paid" | "report_refund") => async () => {
    setBusy(true);
    setError(null);
    try {
      await callContract(method, { bill_id: bill.id }, 0n, 30n);
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
          <strong>{usd(Number(bill.usd_cents))}</strong> <span className="muted">for {bill.period}</span>
          <div className="small muted">
            #{bill.id} to <span className="mono">{bill.miner}</span>, due {fmtDate(fromNs(bill.due_ns))}
          </div>
        </div>
        <StatusTag status={bill.status} />
      </div>
      {bill.ceiling_sats && <div className="small">Miner's ceiling: {sats(Number(bill.ceiling_sats))}</div>}
      {bill.quote && (
        <div className="small">
          Locked quote: {sats(Number(bill.quote.amount_in_sats))} to <span className="mono">{bill.quote.deposit_address}</span>,
          valid until {fmtTime(fromNs(bill.quote.deadline_ns))}
          {quoteExpired && <span className="warn"> (expired, lock a new one)</span>}
        </div>
      )}
      {bill.status === "Issued" && (
        <div className="row">
          <span className="small muted">Waiting for the miner to accept.</span>
          <button className="ghost" onClick={act("withdraw_bill")} disabled={busy}>Withdraw</button>
        </div>
      )}
      <SplitStatus bill={bill} />
      {bill.status === "Paying" && (
        <div className="accept">
          <p className="small">
            Check that the USDC reached <span className="mono">{bill.host_address}</span> (the Basescan link above on
            mainnet), then confirm. If 1Click refunded the swap, report it and lock a new quote.
          </p>
          <div className="row">
            <button onClick={act("confirm_paid")} disabled={busy}>Confirm paid</button>
            <button className="ghost" onClick={act("report_refund")} disabled={busy}>Report refund</button>
          </div>
        </div>
      )}
      {needsQuote && <ApproveQuote bill={bill} onDone={onDone} />}
      {error && <p className="err">{error}</p>}
    </div>
  );
}

function ApproveQuote({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [standin, setStandin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ceiling = Number(bill.ceiling_sats ?? 0);
  const cents = Number(bill.usd_cents);
  const testnet = network === "testnet";

  const fetchQuote = async () => {
    setBusy("Requesting a live 1Click quote...");
    setError(null);
    try {
      const refundTo = payoutFromDerivedKey(await derivedPublicKey(bill.miner)).address;
      const deadline = new Date(Date.now() + QUOTE_TTL_DAYS * 864e5);
      if (testnet) {
        // 1Click has no testnet and won't quote with a tb1 refund address, so price the
        // bill from the live BTC price and let the host supply a testnet deposit address.
        const p = await btcPriceUsd();
        const amountIn = String(usdToSats(cents, p));
        setQuote({ amountIn, minAmountIn: amountIn, amountOut: String(cents * 10_000), deadline: deadline.toISOString(), timeEstimate: 0 });
      } else {
        setQuote(await quoteBillInBtc({ dry: false, usdCents: cents, recipient: bill.host_address, refundTo, deadline }));
      }
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const deposit = testnet ? standin.trim() : quote?.depositAddress ?? "";
  const amountIn = quote ? Number(quote.amountIn) : 0;
  const overCeiling = quote !== null && amountIn > ceiling;

  const approve = async () => {
    if (!quote?.deadline) return;
    if (testnet) {
      const err = coldAddressError(deposit);
      if (err) return setError(err);
    }
    setBusy("Waiting for wallet...");
    setError(null);
    try {
      await callContract(
        "approve_quote",
        { bill_id: bill.id, deposit_address: deposit, amount_in_sats: quote.amountIn, deadline_ns: toNs(new Date(quote.deadline)) },
        0n,
        30n,
      );
      onDone();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="accept">
      {!quote && (
        <button onClick={fetchQuote} disabled={!!busy}>{busy ?? "Get quote"}</button>
      )}
      {quote && (
        <>
          <dl>
            <dt>You receive</dt>
            <dd>{usd(cents)} USDC on Base at <span className="mono">{bill.host_address}</span></dd>
            <dt>Miner pays</dt>
            <dd>{sats(amountIn)} (ceiling {sats(ceiling)})</dd>
            <dt>Quote valid until</dt>
            <dd>{quote.deadline ? fmtTime(new Date(quote.deadline)) : "unknown"}</dd>
            {!testnet && (
              <>
                <dt>1Click deposit</dt>
                <dd className="mono">{quote.depositAddress}</dd>
              </>
            )}
          </dl>
          {testnet && (
            <>
              <p className="small warn">
                Testnet: NEAR Intents has no testnet, so there's no real 1Click deposit address. The amount uses the live
                BTC price. Enter a testnet address you control as a stand-in for the deposit address.
              </p>
              <label>Stand-in deposit address (testnet)<input value={standin} onChange={(e) => setStandin(e.target.value)} placeholder="tb1q..." spellCheck={false} /></label>
            </>
          )}
          {overCeiling && (
            <p className="err">
              This quote needs more than the miner's ceiling, so the contract will refuse it (QUOTE_OVER_CEILING). Ask the
              miner to accept a higher ceiling on a new bill, or wait for a better price.
            </p>
          )}
          <div className="row">
            <button onClick={approve} disabled={!!busy}>{busy ?? "Approve quote on-chain"}</button>
            <button className="ghost" onClick={() => setQuote(null)} disabled={!!busy}>Discard</button>
          </div>
        </>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
