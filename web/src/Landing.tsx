import { useEffect, useState } from "react";
import { MEMPOOL_WEB, NEARBLOCKS_WEB, CONTRACT_ID } from "./config";
import { latestPaidBill, proofFile, runChecks, type Check, type PaidBill } from "./proof";
import { Link } from "./Link";
import { SiteNav } from "./SiteNav";
import { Logo } from "./Brand";

const sats = (v: string | number) => `${Number(v).toLocaleString("en-US")} sats`;
const usd = (cents: string) => `$${(Number(cents) / 100).toFixed(2)}`;
const GITHUB = "https://github.com/mystiquemide/Rigbill";

export default function Landing() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <Doors />
        <How />
        <Refusals />
        <ProofSummary />
        <Faq />
        <section className="block" style={{ paddingTop: 40 }}>
          <div className="wrap">
            <div className="band">
              <div>
                <h2>Set up your payout address in two minutes</h2>
                <p>Sign in with any NEAR wallet, add your cold wallet, and paste the new address into your pool.</p>
              </div>
              <Link to="/miner" className="btn">Open app</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-foot">
        <div className="wrap">
          <div>
            <Logo />
            <p>Bitcoin payouts that pay the hosting bill first.</p>
            <p className="small">Built on NEAR Chain Signatures and NEAR Intents.</p>
          </div>
          <nav aria-label="Footer">
            <Link to="/#how">How it works</Link>
            <Link to="/proof">Proof</Link>
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
            <Link to="/miner">Open app</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap">
        <div className="hero-copy">
          <p className="kicker" style={{ margin: "0 0 28px" }}>Bitcoin payouts for miners and hosts</p>
          <h1 id="hero-title" className="h1">
            Your payouts pay the hosting bill <em>The rest goes to your wallet</em>
          </h1>
          <p>
            A Bitcoin payout address no one holds a key to. A NEAR contract signs only transactions that pay your host
            first, in USDC, then send everything else to your own wallet.
          </p>
          <div className="cta-row">
            <Link to="/miner" className="btn">Open app</Link>
            <Link to="/proof" className="arrow-link">See it working on chain</Link>
          </div>
        </div>
        <LiveBill />
      </div>
    </section>
  );
}

/** A real paid bill read from the contract and Bitcoin, not a picture of one. */
function LiveBill() {
  const [state, setState] = useState<{ s: "loading" } | { s: "error" } | { s: "none" } | { s: "ok"; d: PaidBill }>(proofFile ? { s: "loading" } : { s: "none" });
  useEffect(() => {
    if (!proofFile) return;
    latestPaidBill(proofFile.miner)
      .then((d) => setState(d ? { s: "ok", d } : { s: "none" }))
      .catch(() => setState({ s: "error" }));
  }, []);

  if (state.s !== "ok") {
    return (
      <aside className="panel" aria-live="polite">
        <div className="panel-head"><span className="panel-label">Latest paid bill</span></div>
        <p className="skeleton">
          {state.s === "loading" && "Reading the latest paid bill from the contract and Bitcoin…"}
          {state.s === "error" && "Couldn't reach NEAR or Bitcoin right now. The proof page has every record."}
          {state.s === "none" && "No paid bill on this network yet. The first one appears here as soon as it settles."}
        </p>
        {state.s !== "loading" && <Link to="/proof" className="arrow-link">Open the proof page</Link>}
      </aside>
    );
  }
  const { bill, split, txid, confirmedHeight, fee } = state.d;
  const [host, cold] = split.outputs;
  return (
    <aside className="panel" aria-label={`Bill ${bill.id}, paid`}>
      <div className="panel-head">
        <span className="panel-label">Bill #{bill.id} &middot; paid from a payout</span>
        <span className="chip chip-lime">Paid</span>
      </div>
      <dl style={{ display: "block", margin: 0 }}>
        <div className="kv"><dt>Bill</dt><dd>{usd(bill.usd_cents)} for {bill.period}</dd></div>
        {host && <div className="kv"><dt>To host</dt><dd className="num">{sats(host.value)} via NEAR Intents</dd></div>}
        {cold && <div className="kv"><dt>To the miner</dt><dd className="num">{sats(cold.value)}</dd></div>}
        {fee != null && <div className="kv"><dt>Network fee</dt><dd className="num">{sats(fee)}</dd></div>}
      </dl>
      <ul className="steps">
        <li>Contract signed through NEAR MPC <a className="mono nowrap" href={`${NEARBLOCKS_WEB}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">{CONTRACT_ID}</a></li>
        <li>{confirmedHeight ? <>Bitcoin confirmed <span className="mono">block {confirmedHeight.toLocaleString("en-US")}</span></> : "Bitcoin waiting for confirmation"}</li>
        <li>Host confirmed paid</li>
      </ul>
      <p style={{ margin: "16px 0 0" }}>
        <a className="arrow-link" href={`${MEMPOOL_WEB}/tx/${txid}`} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>View transaction</a>
      </p>
    </aside>
  );
}

function Doors() {
  const doors = [
    { k: "I mine", t: "Keep your coins in your own wallet", d: "Hosting gets paid on time without you selling by hand every month. Your host can only ever take what you agreed to.", pts: ["Your pool pays one address, nothing else changes", "You set the most a bill can cost in sats", "Everything left over goes straight to your cold wallet"], cta: "Set up payouts", to: "/miner" },
    { k: "I host miners", t: "Bill in dollars, get USDC on Base", d: "No chasing invoices, no 30 day power deposits. While your bill is open, the contract won't release a single payout without paying you first.", pts: ["Bill a miner in USD from the web app", "Lock a live NEAR Intents quote", "USDC lands in your own Base wallet"], cta: "Issue a bill", to: "/host" },
  ];
  return (
    <section id="doors" className="block" aria-labelledby="doors-title">
      <div className="wrap">
        <div className="block-head">
          <div>
            <p className="kicker">Start where you are</p>
            <h2 id="doors-title" className="h2">Two sides of one bill, both protected</h2>
          </div>
          <p>Miners keep custody of their coins. Hosts get paid in dollars on time. The contract sits in the middle and enforces the deal.</p>
        </div>
        <div className="doors">
          {doors.map((d) => (
            <article key={d.k} className="panel door">
              <p className="kicker">{d.k}</p>
              <h3>{d.t}</h3>
              <p>{d.d}</p>
              <ul>{d.pts.map((p) => <li key={p}>{p}</li>)}</ul>
              <Link to={d.to} className="btn">{d.cta}</Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function How() {
  const steps = [
    ["Point your pool at your Rigbill address", "Any pool that pays to a Bitcoin address works. The address is derived from the Rigbill contract by NEAR's MPC network, so no person or server holds its key."],
    ["Your host sends a bill, you set the most it can cost", "Bills are in US dollars. You accept with a ceiling in sats, and the contract refuses any quote above it."],
    ["A payout lands and the contract splits it", "The contract builds the Bitcoin transaction itself and signs only if it pays the bill's quote first and sends the rest to your wallet."],
    ["Your host gets USDC, you keep the rest", "NEAR Intents swaps the host's share to USDC on Base. Later payouts go straight to your cold wallet."],
  ];
  return (
    <section id="how" className="block" aria-labelledby="how-title">
      <div className="wrap">
        <p className="kicker">How it works</p>
        <h2 id="how-title" className="h2" style={{ marginBottom: 40 }}>One rule, enforced by the contract</h2>
        <ol className="how">
          {steps.map(([t, d], i) => (
            <li key={t}><span className="n">0{i + 1}</span><h3>{t}</h3><p>{d}</p></li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Refusals() {
  if (!proofFile) return null;
  return (
    <section className="block" aria-labelledby="rule-title">
      <div className="wrap">
        <div className="block-head">
          <div>
            <p className="kicker">What it refuses</p>
            <h2 id="rule-title" className="h2">Nothing leaves without paying the bill, not even for you</h2>
          </div>
          <p>These are real refusals on NEAR {proofFile.network}. Each one failed on chain and never reached the signer, so no Bitcoin transaction could follow.</p>
        </div>
        <div className="refusals">
          {proofFile.refusals.map((r) => (
            <div key={r.tx} className="refusal">
              <span>{r.attempt}</span>
              <span className="chip chip-lost code">{r.expect}</span>
              <a className="arrow-link" href={`${NEARBLOCKS_WEB}/txns/${r.tx}`} target="_blank" rel="noreferrer">nearblocks {r.tx.slice(0, 8)}&hellip;</a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProofSummary() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [status, setStatus] = useState<"running" | "done" | "error">("running");
  useEffect(() => {
    runChecks(setChecks).then(() => setStatus("done")).catch(() => setStatus("error"));
  }, []);
  const groups = ["Contract", "Payout address", "Bills", "Refusals"] as const;
  const summary: Record<(typeof groups)[number], string> = {
    Contract: "Contract signs through the NEAR MPC network",
    "Payout address": "Payout address comes from the MPC key",
    Bills: "Bitcoin splits match what the contract signed",
    Refusals: "Every refusal failed without reaching the signer",
  };
  return (
    <section id="proof" className="block" aria-labelledby="proof-title">
      <div className="wrap">
        <div className="block-head">
          <div>
            <p className="kicker">Check it yourself</p>
            <h2 id="proof-title" className="h2">Don't trust us, read the chain</h2>
          </div>
          <div style={{ maxWidth: 460 }}>
            <p className="muted" style={{ margin: "0 0 20px" }}>These checks run in your browser right now against the contract, Bitcoin and NEAR. They are the same checks as npm run verify in the repo.</p>
            <Link to="/proof" className="btn btn-dark">Open proof page</Link>
          </div>
        </div>
        <div className="panel checks" aria-live="polite">
          {groups.map((g) => {
            const rows = checks.filter((c) => c.group === g);
            const failed = rows.filter((c) => !c.ok).length;
            // Counts only mean something once every check has finished.
            const pending = status === "running";
            const label = status === "error" && rows.length === 0 ? "Couldn't run" : pending ? "Checking" : failed ? `${failed} failed` : `${rows.length} of ${rows.length}`;
            return (
              <div key={g} className="check">
                <span className={`led${pending ? " off" : failed || (status === "error" && rows.length === 0) ? " bad" : ""}`} aria-label={pending ? "Checking" : failed ? "Failed" : "Passed"} />
                <span>{summary[g]}</span>
                <span className="detail">{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const qa = [
    ["Who holds the keys to my payout address?", "No one. The address belongs to the Rigbill contract and is signed for by NEAR's MPC network, which only signs what the contract approves."],
    ["What if my host never confirms the bill as paid?", "An unpaid bill releases you seven days after its due date, and your payouts go straight to your wallet again."],
    ["What does it cost?", "The Bitcoin network fee, which you cap, plus the NEAR Intents swap spread on the host's share. Rigbill takes nothing."],
    ["Which pools work?", "Any pool that pays to a Bitcoin address. You paste your Rigbill address where your payout address goes."],
    ["What is the smallest bill?", "NEAR Intents won't swap less than about 8,300 sats. The app shows the current dollar amount and warns hosts before they issue a smaller bill."],
    ["What if the swap is refunded?", "The BTC comes back to your payout address, the host locks a new quote, and the next split pays it."],
  ];
  return (
    <section className="block" aria-labelledby="faq-title">
      <div className="wrap">
        <p className="kicker">Questions</p>
        <h2 id="faq-title" className="h2" style={{ marginBottom: 40 }}>Asked by miners and hosts first</h2>
        <div className="faq">
          {qa.map(([q, a], i) => (
            <details key={q} open={i === 0}><summary>{q}</summary><p>{a}</p></details>
          ))}
        </div>
      </div>
    </section>
  );
}
