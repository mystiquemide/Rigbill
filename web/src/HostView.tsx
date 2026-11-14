import { useEffect, useState } from "react";
import { coldAddressError, payoutFromDerivedKey } from "./btc";
import { BILL_STORAGE_DEPOSIT, MEMPOOL_WEB, network } from "./config";
import { fmtDate, fmtTime, fromNs, msg, sats, toNs, usd } from "./format";
import { Lifecycle } from "./Lifecycle";
import { Link } from "./Link";
import { derivedPublicKey, getBill, getBillsForHost, getMiner, getSplit, quoteLive, refetchBillUntilChanged, type Bill } from "./near";
import { ONECLICK_MIN_SATS, btcPriceUsd, quoteBillInBtc, swapStatus, usdToSats, type Quote, type SwapStatusResponse } from "./oneclick";
import { usePath } from "./routing";
import { SplitStatus } from "./SplitStatus";
import { ErrorBox, ErrorNote, Skeleton, StaleNote, StatusTag } from "./ui";
import { useLoad, useNow } from "./useLoad";
import { callContract } from "./wallet";

const QUOTE_TTL_DAYS = 3;
const isEvm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

/** /host: S6 home, or S7 for /host/bills/:id. */
export function HostView({ account }: { account: string }) {
  const id = usePath().match(/^\/host\/bills\/(\d+)$/)?.[1];
  return id ? <HostBillDetail account={account} id={id} /> : <HostHome account={account} />;
}

// ---------------------------------------------------------------- S6

function HostHome({ account }: { account: string }) {
  const list = useLoad(`host-bills:${account}`, () => getBillsForHost(account));
  const bills = list.data;
  // After issuing, wait until a lagging RPC node shows the new bill.
  const afterIssue = async () => {
    const before = bills?.length ?? 0;
    for (let i = 0; i < 8; i++) {
      const b = await getBillsForHost(account).catch(() => null);
      if (b && b.length > before) return list.set(b);
      await new Promise((r) => setTimeout(r, 1250));
    }
    list.reload();
  };

  return (
    <div className="host-home">
      <h1 className="sr-only">Your bills</h1>
      <IssueForm onDone={() => void afterIssue()} />
      <section className="panel host-bills" aria-labelledby="issued-title">
        <div className="row"><p className="kicker" id="issued-title">Bills you issued</p>{bills && <span className="muted small">{bills.length} {bills.length === 1 ? "bill" : "bills"}</span>}</div>
        {list.error && !bills && <ErrorBox what="Couldn't read your bills" error={list.error} retry={list.reload} />}
        {list.error && bills && <StaleNote error={list.error} retry={list.reload} />}
        {!bills && !list.error && <Skeleton label="Reading your bills from the contract…" />}
        {bills?.length === 0 && <p className="note">No bills yet. Issue your first one with the form. Nothing happens until the miner accepts it.</p>}
        {bills?.map((b) => <HostRow key={b.id} bill={b} />)}
      </section>
    </div>
  );
}

const NEXT: Record<Bill["status"], string> = {
  Issued: "Waiting for the miner to accept",
  Accepted: "Lock a quote",
  QuoteApproved: "Waiting for the miner's next payout",
  Paying: "Check the USDC, then confirm paid",
  Paid: "Paid",
  Expired: "Expired unpaid",
  Withdrawn: "Withdrawn",
};

function HostRow({ bill }: { bill: Bill }) {
  const action = bill.status === "Accepted" || bill.status === "Paying";
  return (
    <Link to={`/host/bills/${bill.id}`} className="host-row" aria-label={`Bill ${bill.id}, ${usd(Number(bill.usd_cents))}, ${bill.status}`}>
      <div className="row">
        <span className="host-row-main"><span className="mono muted">#{bill.id}</span><strong>{usd(Number(bill.usd_cents))}</strong><span className="muted">{bill.period}</span></span>
        <StatusTag status={bill.status} />
      </div>
      <span className="mono small">to {bill.miner}</span>
      <span className={action ? "lime small" : "muted small"}>{NEXT[bill.status]}</span>
    </Link>
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
  const [error, setError] = useState<unknown>(null);
  const now = useNow();
  useEffect(() => { btcPriceUsd().then(setPrice).catch(() => setPrice(null)); }, []);

  const cents = Math.round(Number(amount) * 100);
  const dueDate = new Date(due + "T23:59:59");
  const errs = {
    miner: /^[a-z0-9._-]{2,64}$/.test(miner.trim()) ? null : "Enter the miner's NEAR account.",
    amount: Number.isFinite(cents) && cents > 0 ? null : "Enter the bill amount in US dollars.",
    period: period.trim() && period.length <= 64 ? null : "Describe the period in up to 64 characters.",
    due: dueDate.getTime() > now ? null : "The due date must be in the future.",
    addr: isEvm(addr) ? null : "Enter a Base address: 0x followed by 40 hex characters.",
  };
  const estSats = price && cents > 0 ? usdToSats(cents, price) : null;
  const belowMin = estSats !== null && estSats < ONECLICK_MIN_SATS;
  const bad = (k: keyof typeof errs) => touched && !!errs[k];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await getMiner(miner.trim()))) throw new Error("MINER_NOT_REGISTERED");
      await callContract("issue_bill", { miner: miner.trim(), usd_cents: String(cents), period: period.trim(), due_ns: toNs(dueDate), host_address: addr.trim() }, BILL_STORAGE_DEPOSIT, 30n);
      setMiner(""); setAmount(""); setTouched(false);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const amountHelp: string = bad("amount") ? errs.amount ?? ""
    : estSats !== null ? `About ${sats(estSats)} at $${price!.toLocaleString("en-US")} per BTC.${belowMin ? ` That's under 1Click's ${sats(ONECLICK_MIN_SATS)} minimum, so a quote for it can't be locked.` : ""}`
    : "The miner's payouts pay this in USDC on Base.";
  return (
    <form className="panel form issue" onSubmit={submit} noValidate aria-labelledby="issue-title">
      <div>
        <p className="kicker" id="issue-title">Issue a bill</p>
        <p className="muted" style={{ margin: "16px 0 0", fontSize: 15 }}>Bill a miner in US dollars. You get USDC on Base when their next payout lands.</p>
      </div>
      <Field id="miner" label="Miner's NEAR account" value={miner} set={setMiner} help={bad("miner") ? errs.miner! : "The account the miner signs in to Rigbill with."} bad={bad("miner")} />
      <Field id="amount" label="Amount (USD)" value={amount} set={setAmount} help={amountHelp} bad={bad("amount")} warn={belowMin} mode="decimal" />
      <Field id="period" label="Period" value={period} set={setPeriod} help={bad("period") ? errs.period! : "Shown to the miner on the bill."} bad={bad("period")} />
      <Field id="due" label="Due date" value={due} set={setDue} type="date" help={bad("due") ? errs.due! : "If it's still unpaid 7 days after this date, the bill expires."} bad={bad("due")} />
      <Field id="addr" label="Your Base address for USDC" value={addr} set={setAddr} help={bad("addr") ? errs.addr! : "Your own wallet on Base. USDC goes straight there. Rigbill never holds it."} bad={bad("addr")} />
      {error != null && <ErrorNote error={error} />}
      <div className="form-actions"><button type="submit" disabled={busy}>{busy ? "Waiting for your wallet…" : "Issue bill"}</button></div>
      <p className="help" style={{ marginTop: -10 }}>Locks 0.01 NEAR for storage. The bill does nothing until the miner accepts it.</p>
    </form>
  );
}

function Field({ id, label, value, set, help, bad, warn, type = "text", mode }: { id: string; label: string; value: string; set: (v: string) => void; help: string; bad: boolean; warn?: boolean; type?: string; mode?: "decimal" }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => set(e.target.value)} spellCheck={false} autoComplete="off" inputMode={mode} aria-invalid={bad} aria-describedby={`${id}-help`} />
      <p id={`${id}-help`} className={bad ? "help bad" : warn ? "help warn" : "help"}>{help}</p>
    </div>
  );
}

// ---------------------------------------------------------------- S7

function HostBillDetail({ account, id }: { account: string; id: string }) {
  const load = useLoad(`host-bill:${id}`, () => getBill(id));
  const bill = load.data;

  const back = <Link to="/host" className="back-link">Back to your bills</Link>;
  if (load.error && bill === undefined) return <>{back}<ErrorBox what={`Couldn't read bill #${id}`} error={load.error} retry={load.reload} /></>;
  if (bill === undefined) return <>{back}<Skeleton label={`Reading bill #${id} from the contract…`} lines={4} /></>;
  if (bill === null || bill.host !== account) {
    return <>{back}<section className="panel"><p className="kicker">Bill #{id}</p><p className="muted" style={{ margin: "16px 0 0" }}>There is no bill #{id} issued by {account}.</p></section></>;
  }
  const afterTx = () => void refetchBillUntilChanged(id, bill.status).then((b) => (b ? load.set(b) : load.reload())).catch(() => load.reload());
  return (
    <>
      {load.error && <StaleNote error={load.error} retry={load.reload} />}
      <HostBill bill={bill} back={back} onChanged={afterTx} />
    </>
  );
}

function HostBill({ bill, back, onChanged }: { bill: Bill; back: React.ReactNode; onChanged: () => void }) {
  const now = useNow();
  const quoteExpired = !!bill.quote && !quoteLive(bill.quote, now);
  const needsQuote = bill.status === "Accepted" || (bill.status === "QuoteApproved" && quoteExpired);
  return (
    <div className="bill-detail">
      {back}
      <header className="bill-head">
        <div>
          <p className="kicker">Bill #{bill.id}</p>
          <h1 className="h2 bill-title">{usd(Number(bill.usd_cents))} for {bill.period}</h1>
          <p className="muted">To <span className="mono">{bill.miner}</span>{bill.ceiling_sats ? `, ceiling ${sats(Number(bill.ceiling_sats))}` : ""}, due {fmtDate(fromNs(bill.due_ns))}</p>
        </div>
        {bill.status === "Accepted" ? <span className="chip chip-warn">Needs a quote</span> : <StatusTag status={bill.status} />}
      </header>
      <div className="bill-grid">
        <div className="bill-main">
          {bill.status === "Issued" && <IssuedPanel bill={bill} onChanged={onChanged} />}
          {needsQuote && <LockQuote bill={bill} expired={quoteExpired} onDone={onChanged} />}
          {bill.status === "QuoteApproved" && !quoteExpired && <LockedPanel bill={bill} />}
          {(bill.status === "Paying" || bill.status === "Paid" || (bill.status === "Expired" && bill.split_id)) && <PaymentPanel bill={bill} onChanged={onChanged} />}
        </div>
        <Lifecycle bill={bill} side="host" />
      </div>
    </div>
  );
}

function useAct(bill: Bill, onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const act = (method: "withdraw_bill" | "confirm_paid" | "report_refund") => async () => {
    setBusy(method);
    setError(null);
    try {
      await callContract(method, { bill_id: bill.id }, 0n, 30n);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, act };
}

function IssuedPanel({ bill, onChanged }: { bill: Bill; onChanged: () => void }) {
  const { busy, error, act } = useAct(bill, onChanged);
  return (
    <section className="panel">
      <h2 className="panel-title">Waiting for the miner</h2>
      <p className="note note-review"><span><span className="mono">{bill.miner}</span> sees this bill in Rigbill and sets the most it can cost. Until then it changes nothing for them.</span></p>
      <p className="muted" style={{ margin: "16px 0", fontSize: 15 }}>Made a mistake? You can withdraw the bill until the miner accepts it.</p>
      <button className="ghost" onClick={act("withdraw_bill")} disabled={!!busy}>{busy ? "Waiting for your wallet…" : "Withdraw bill"}</button>
      {error != null && <ErrorNote error={error} />}
    </section>
  );
}

function LockedPanel({ bill }: { bill: Bill }) {
  const q = bill.quote!;
  return (
    <section className="panel">
      <h2 className="panel-title">Quote locked</h2>
      <dl className="kv-list">
        <div className="kv"><dt>Miner pays</dt><dd className="num">{sats(Number(q.amount_in_sats))}</dd></div>
        <div className="kv"><dt>Deposit address</dt><dd className="num">{q.deposit_address}</dd></div>
        <div className="kv"><dt>Valid until</dt><dd className="num">{fmtTime(fromNs(q.deadline_ns))}</dd></div>
        <div className="kv"><dt>You receive</dt><dd>{usd(Number(bill.usd_cents))} USDC on Base at <span className="mono">{bill.host_address}</span></dd></div>
      </dl>
      <p className="note note-lime">The miner's next payout sends exactly this to the deposit address before anything reaches their wallet.</p>
    </section>
  );
}

function PaymentPanel({ bill, onChanged }: { bill: Bill; onChanged: () => void }) {
  const { busy, error, act } = useAct(bill, onChanged);
  const split = useLoad(`split:${bill.split_id ?? "-"}`, () => (bill.split_id ? getSplit(bill.split_id) : Promise.resolve(null))).data ?? null;
  const [toHost, toMiner] = split?.outputs ?? [];
  // A bill that expired while a split was paying it can still be confirmed paid.
  const paying = bill.status === "Paying" || (bill.status === "Expired" && !!bill.split_id);
  const swap = useSwapWatch(paying && network === "mainnet" ? bill.quote?.deposit_address : undefined);
  const delivered = swap?.status === "SUCCESS";
  const outTx = swap?.swapDetails?.destinationChainTxHashes?.[0]?.hash;
  return (
    <section className="panel">
      <h2 className="panel-title">{paying ? "The miner's payout was split" : "Paid"}</h2>
      {split && (
        <dl className="kv-list">
          {toHost && <div className="kv"><dt>To deposit</dt><dd className="num">{sats(Number(toHost.value))}</dd></div>}
          {toMiner && <div className="kv"><dt>To miner</dt><dd className="num">{sats(Number(toMiner.value))}</dd></div>}
          <div className="kv"><dt>Bitcoin split</dt><dd className="num"><a href={`${MEMPOOL_WEB}/tx/${split.txid}`} target="_blank" rel="noreferrer">{split.txid}</a></dd></div>
        </dl>
      )}
      <div style={{ marginTop: 16 }}><SplitStatus bill={bill} /></div>
      {paying && delivered && (
        <div className="delivered" role="status">
          <p className="kicker" style={{ margin: 0 }}>1Click delivered the USDC</p>
          <p style={{ margin: "8px 0 16px" }}>
            {swap?.swapDetails?.amountOutFormatted ?? usd(Number(bill.usd_cents))} USDC reached <span className="mono">{bill.host_address}</span> on Base.
            {outTx && <> <a href={`https://basescan.org/tx/${outTx}`} target="_blank" rel="noreferrer">See it on Basescan</a></>}
          </p>
          <button onClick={act("confirm_paid")} disabled={!!busy}>{busy === "confirm_paid" ? "Waiting for your wallet…" : "Confirm paid"}</button>
        </div>
      )}
      {paying && swap && ["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(swap.status) && (
        <div className="delivered" role="status">
          <p className="kicker" style={{ margin: 0 }}>
            {swap.status === "REFUNDED" ? "1Click refunded the swap" : swap.status === "FAILED" ? "The swap failed" : "1Click received less than quoted"}
          </p>
          <p style={{ margin: "8px 0 16px" }}>The BTC goes back to the miner's payout address. Report it so the bill returns to accepted, then lock a new quote.</p>
          <button onClick={act("report_refund")} disabled={!!busy}>{busy === "report_refund" ? "Waiting for your wallet…" : "Report and lock a new quote"}</button>
        </div>
      )}
      {paying && !delivered && !(swap && ["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(swap.status)) && (
        <>
          {swap && <p className="note">1Click is still working on it ({swap.status.toLowerCase().replace(/_/g, " ")}). This updates on its own.</p>}
          <p className="note note-review">Check that {usd(Number(bill.usd_cents))} USDC reached <span className="mono">{bill.host_address}</span>, then confirm. If 1Click refunded the swap, report it and lock a new quote.</p>
          <div className="actions">
            <button onClick={act("confirm_paid")} disabled={!!busy}>{busy === "confirm_paid" ? "Waiting for your wallet…" : "Confirm paid"}</button>
            <button className="ghost" onClick={act("report_refund")} disabled={!!busy}>{busy === "report_refund" ? "Waiting for your wallet…" : "Swap refunded or failed"}</button>
          </div>
        </>
      )}
      {error != null && <ErrorNote error={error} />}
    </section>
  );
}

function LockQuote({ bill, expired, onDone }: { bill: Bill; expired: boolean; onDone: () => void }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [standin, setStandin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ceiling = Number(bill.ceiling_sats ?? 0);
  const cents = Number(bill.usd_cents);
  const testnet = network === "testnet";

  const fetchQuote = async () => {
    setBusy("Requesting a live quote…");
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
    setBusy("Waiting for your wallet…");
    setError(null);
    try {
      await callContract("approve_quote", { bill_id: bill.id, deposit_address: deposit, amount_in_sats: quote.amountIn, deadline_ns: toNs(new Date(quote.deadline)) }, 0n, 30n);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel" aria-labelledby="quote-title">
      <h2 className="panel-title" id="quote-title">{expired ? "Lock a new quote" : "Lock a NEAR Intents quote"}</h2>
      <p className="muted" style={{ margin: "0 0 16px", fontSize: 15 }}>
        {expired ? "The last quote expired before a payout arrived. " : ""}
        The miner's next payout sends exactly the quoted sats to the deposit address, and 1Click swaps them into your USDC.
      </p>
      {!quote && <button onClick={fetchQuote} disabled={!!busy}>{busy ?? "Get a live quote"}</button>}
      {quote && (
        <>
          <dl className="kv-list">
            <div className="kv"><dt>You receive</dt><dd>{usd(cents)} USDC on Base</dd></div>
            <div className="kv"><dt>To</dt><dd className="num">{bill.host_address}</dd></div>
            <div className="kv"><dt>Miner pays</dt><dd className="num">{sats(amountIn)} (ceiling {sats(ceiling)})</dd></div>
            <div className="kv"><dt>Valid until</dt><dd className="num">{quote.deadline ? fmtTime(new Date(quote.deadline)) : "Set by 1Click"}</dd></div>
            {!testnet && <div className="kv"><dt>1Click deposit</dt><dd className="num">{quote.depositAddress}</dd></div>}
            {!testnet && quote.timeEstimate > 0 && <div className="kv"><dt>Swap time</dt><dd>about {Math.round(quote.timeEstimate / 60)} minutes after confirmation</dd></div>}
          </dl>
          {testnet && (
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="standin">Stand-in deposit address (testnet)</label>
              <input id="standin" value={standin} onChange={(e) => setStandin(e.target.value)} spellCheck={false} autoComplete="off" aria-describedby="standin-help" />
              <p id="standin-help" className="help warn">NEAR Intents has no testnet, so there's no real 1Click deposit address. Enter a testnet address you control. The amount uses the live BTC price.</p>
            </div>
          )}
          {overCeiling && <p className="note note-lost">This quote needs more than the miner's ceiling, so the contract would refuse it (QUOTE_OVER_CEILING). Get a new quote when the price moves back.</p>}
          <div className="actions">
            <button onClick={approve} disabled={!!busy || overCeiling}>{busy ?? "Lock this quote"}</button>
            <button className="ghost" onClick={fetchQuote} disabled={!!busy}>Get a new quote</button>
          </div>
          <p className="note">If the swap is ever refunded, the BTC goes back to the miner's payout address, never to Rigbill.</p>
        </>
      )}
      {error != null && <ErrorNote error={error} />}
    </section>
  );
}

/** Polls 1Click for the swap behind a paying bill until it settles, so the host can confirm in one click. */
function useSwapWatch(depositAddress: string | undefined): SwapStatusResponse | null {
  const [swap, setSwap] = useState<SwapStatusResponse | null>(null);
  useEffect(() => {
    if (!depositAddress) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const st = await swapStatus(depositAddress).catch(() => null);
      if (!alive) return;
      if (st) setSwap(st);
      if (!st || !["SUCCESS", "REFUNDED", "FAILED"].includes(st.status)) timer = setTimeout(tick, 20000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [depositAddress]);
  return swap;
}
