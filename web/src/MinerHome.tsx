import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { COINBASE_MATURITY, MEMPOOL_WEB, SIGNER_ID } from "./config";
import { getTipHeight, getUtxos } from "./esplora";
import { fmtDate, fmtTime, fromNs, sats, usd } from "./format";
import { Link } from "./Link";
import { MinerForm } from "./MinerSetup";
import { getBill, getBillsForMiner, getOpenBill, getRelayers, getSplit, quoteLive, type Bill, type Miner, type Split } from "./near";
import { SplitStatus } from "./SplitStatus";
import { SweepButton } from "./SweepButton";
import { ErrorBox, ErrorNote, Skeleton, StaleNote, StatusTag } from "./ui";
import { useLoad, useNow } from "./useLoad";
import { callContract } from "./wallet";

type Payout = { pubkey: string; address: string };

/** S4: everything a registered miner needs, read live from the contract and Bitcoin. */
export default function MinerHome({ account, miner, payout, onChanged }: { account: string; miner: Miner; payout: Payout; onChanged: () => void }) {
  const billsLoad = useLoad(`miner-bills:${account}`, () => Promise.all([getBillsForMiner(account), getOpenBill(account)]));
  const bills = billsLoad.data?.[0] ?? null;
  const open = billsLoad.data?.[1] ?? null;
  // Anything that changes the contract (settings, relayers, a release) refreshes the bills too.
  const changed = () => { onChanged(); billsLoad.reload(); };

  return (
    <div className="miner-home">
      <h1 className="sr-only">Your payouts</h1>
      <div className="grid-top">
        <PayoutCard address={payout.address} pending={!miner.payout_pubkey} />
        <BalancePanel address={payout.address} />
      </div>
      {billsLoad.error && !billsLoad.data && <ErrorBox what="Couldn't read your bills" error={billsLoad.error} retry={billsLoad.reload} />}
      {billsLoad.error && billsLoad.data && <StaleNote error={billsLoad.error} retry={billsLoad.reload} />}
      {open && <OpenBill bill={open} />}
      <div className="grid-mid">
        <History bills={bills} account={account} />
        {open ? <SweepButton account={account} miner={miner} payoutAddress={payout.address} bill={open} /> : <NoBillNote />}
      </div>
      <Settings miner={miner} payout={payout} onChanged={changed} />
      <div className="grid-mid">
        <Relayers account={account} />
        <ReleaseSplit account={account} onChanged={changed} />
      </div>
    </div>
  );
}

function PayoutCard({ address, pending }: { address: string; pending: boolean }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const toggleQr = async () => {
    if (qr) return setQr(null);
    setQr(await QRCode.toString(`bitcoin:${address}`, { type: "svg", margin: 1, color: { dark: "#000000", light: "#ffffff" } }));
  };
  return (
    <section className="panel payout" aria-labelledby="payout-title">
      <p className="kicker" id="payout-title">Your payout address</p>
      <p className="address">{address}</p>
      <p className="muted">Paste this into your pool's payout settings. Only the Rigbill contract can sign for it, through NEAR's MPC network.</p>
      {pending && <p className="note note-review">The contract is still recording this address. Refresh in a few seconds before you share it.</p>}
      <div className="actions">
        <button onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
        <button className="ghost" onClick={toggleQr} aria-expanded={!!qr}>{qr ? "Hide QR code" : "Show QR code"}</button>
        <a className="arrow-link" href={`${MEMPOOL_WEB}/address/${address}`} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>View on mempool.space</a>
      </div>
      {qr && <div className="qr" role="img" aria-label={`QR code for ${address}`} dangerouslySetInnerHTML={{ __html: qr }} />}
    </section>
  );
}

function BalancePanel({ address }: { address: string }) {
  const bal = useLoad(`balance:${address}`, () => Promise.all([getUtxos(address), getTipHeight()]).then(([utxos, tip]) => ({ utxos, tip })));
  const data = bal.data;
  const error = bal.error;
  const load = bal.reload;

  const confirmed = data?.utxos.filter((u) => u.status.confirmed).reduce((a, u) => a + u.value, 0) ?? 0;
  const waiting = data?.utxos.filter((u) => !u.status.confirmed).reduce((a, u) => a + u.value, 0) ?? 0;
  return (
    <section className="panel balance" aria-labelledby="balance-title" aria-live="polite">
      <div className="row"><p className="kicker" id="balance-title">Balance</p>{data && <button className="link-btn" onClick={load} disabled={bal.pending}>{bal.pending ? "Refreshing…" : "Refresh balance"}</button>}</div>
      {!data && !error && <Skeleton label="Reading the payout address on Bitcoin…" lines={2} />}
      {error && !data && <><p className="note note-warn">Couldn't reach Bitcoin data right now. Your funds are fine.</p><button className="btn-dark" onClick={load}>Try again</button></>}
      {error && data && <StaleNote error={error} retry={load} />}
      {data && (
        <>
          <p className="big-num">{sats(confirmed)}</p>
          <p className="muted small">confirmed at the payout address</p>
          {waiting > 0 && <p className="note note-review">{sats(waiting)} waiting for confirmation: 0 of 1. Splits start after one confirmation.</p>}
          {data.utxos.length === 0 && <p className="note">Nothing waiting. Payouts sent to your address show up here, then get split.</p>}
          {data.utxos.length > 0 && (
            <ul className="utxos">
              {data.utxos.map((u) => (
                <li key={`${u.txid}:${u.vout}`}>
                  <a className="mono" href={`${MEMPOOL_WEB}/tx/${u.txid}`} target="_blank" rel="noreferrer">{u.txid.slice(0, 10)}&hellip;:{u.vout}</a>
                  <span>{sats(u.value)}</span>
                  <span className="muted small">{u.status.confirmed && u.status.block_height ? `${data.tip - u.status.block_height + 1} conf` : "0 conf"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Coinbase payouts can't be spent until they're {COINBASE_MATURITY} blocks deep.</p>
        </>
      )}
    </section>
  );
}

function OpenBill({ bill }: { bill: Bill }) {
  const q = bill.quote;
  const now = useNow();
  const quoteIsLive = quoteLive(q, now);
  return (
    <section className="panel open-bill" aria-labelledby="open-title">
      <div className="row"><p className="kicker" id="open-title">Open bill #{bill.id}</p><StatusTag status={bill.status} /></div>
      <div className="open-grid">
        <div>
          <p className="big-num">{usd(Number(bill.usd_cents))}</p>
          <p className="muted">{bill.period} from <span className="mono">{bill.host}</span></p>
        </div>
        <dl className="kv-list">
          <div className="kv"><dt>Due</dt><dd>{fmtDate(fromNs(bill.due_ns))}</dd></div>
          {bill.ceiling_sats && <div className="kv"><dt>Your ceiling</dt><dd className="num">{sats(Number(bill.ceiling_sats))}</dd></div>}
          {q && <div className="kv"><dt>Locked quote</dt><dd className="num">{sats(Number(q.amount_in_sats))}</dd></div>}
          {q && <div className="kv"><dt>Quote valid until</dt><dd className="num">{fmtTime(fromNs(q.deadline_ns))}</dd></div>}
        </dl>
      </div>
      {bill.status === "QuoteApproved" && quoteIsLive && <p className="note note-lime">Your next payout pays {sats(Number(q!.amount_in_sats))} to your host first. Everything above that goes to your wallet.</p>}
      {bill.status === "QuoteApproved" && !quoteIsLive && <p className="note note-warn">The locked quote has expired. Your host needs to lock a new one before the next payout can be split.</p>}
      {bill.status === "Accepted" && <p className="note note-review">Waiting for your host to lock a quote. Payouts stay at your address until then.</p>}
      {bill.status === "Paying" && <SplitStatus bill={bill} />}
    </section>
  );
}

function History({ bills, account }: { bills: Bill[] | null; account: string }) {
  const hasOpen = !!bills?.some((b) => ["Accepted", "QuoteApproved", "Paying"].includes(b.status));
  return (
    <section className="panel history" aria-labelledby="history-title">
      <div className="row"><p className="kicker" id="history-title">Bills</p>{bills && <span className="muted small">{bills.length} {bills.length === 1 ? "bill" : "bills"}</span>}</div>
      {!bills && <Skeleton label="Reading your bills from the contract…" />}
      {bills?.length === 0 && <p className="note">No bills yet. When your host bills <span className="mono">{account}</span>, it shows up here with what it will cost.</p>}
      {bills?.map((b) => <HistoryRow key={b.id} bill={b} canAccept={!hasOpen} />)}
    </section>
  );
}

function HistoryRow({ bill, canAccept }: { bill: Bill; canAccept: boolean }) {
  const split = useLoad(`split:${bill.split_id ?? "-"}`, () => (bill.split_id ? getSplit(bill.split_id) : Promise.resolve(null))).data ?? null;
  const extra =
    bill.status === "Issued" ? <span className={canAccept ? "lime small" : "muted small"}>{canAccept ? "Review and accept" : "Waits for your open bill"}</span>
      : bill.status === "Paid" && split ? <span className="mono">split {split.txid.slice(0, 8)}&hellip;</span>
      : bill.status === "QuoteApproved" ? <span className="muted small">Waiting for a payout</span>
      : bill.status === "Accepted" ? <span className="muted small">Waiting for your host's quote</span>
      : bill.status === "Paying" ? <span className="muted small">Paying from this payout</span>
      : null;
  return (
    <Link to={`/miner/bills/${bill.id}`} className="hist-row" aria-label={`Bill ${bill.id}, ${usd(Number(bill.usd_cents))}, ${bill.status}`}>
      <span className="mono muted">#{bill.id}</span>
      <strong>{usd(Number(bill.usd_cents))}</strong>
      <span className="muted">{bill.period}</span>
      <StatusTag status={bill.status} />
      <span className="hist-extra">{extra}</span>
    </Link>
  );
}

function NoBillNote() {
  return (
    <section className="panel" aria-labelledby="free-title">
      <p className="kicker" id="free-title">No open bill</p>
      <p className="muted" style={{ margin: 0 }}>With no open bill, every payout goes straight to your cold wallet when it's split. Nothing goes to anyone else.</p>
    </section>
  );
}

function Settings({ miner, payout, onChanged }: { miner: Miner; payout: Payout; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="panel settings" aria-labelledby="settings-title">
      <div className="row">
        <p className="kicker" id="settings-title">Settings</p>
        {!editing && <button className="ghost" onClick={() => setEditing(true)}>Edit settings</button>}
      </div>
      {editing ? (
        <MinerForm initial={miner} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />
      ) : (
        <dl className="kv-list">
          <div className="kv"><dt>Cold wallet</dt><dd className="num"><a href={`${MEMPOOL_WEB}/address/${miner.cold_address}`} target="_blank" rel="noreferrer">{miner.cold_address}</a></dd></div>
          <div className="kv"><dt>Fee cap per payout</dt><dd className="num">{sats(Number(miner.fee_cap_sats))}</dd></div>
          <div className="kv"><dt>Payout key</dt><dd className="num">{payout.pubkey.slice(0, 8)}&hellip;{payout.pubkey.slice(-4)}, derived by {SIGNER_ID}</dd></div>
        </dl>
      )}
    </section>
  );
}

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const MAX_RELAYERS = 3;

/** The miner approves up to three accounts that may ask the contract to sign splits for them. */
function Relayers({ account }: { account: string }) {
  const [saved, setSaved] = useState<string[] | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    getRelayers(account).then((r) => { setSaved(r); setList(r); }).catch((e) => setError(e));
  }, [account]);
  useEffect(load, [load]);

  const add = () => {
    const a = draft.trim().toLowerCase();
    if (!a || list.includes(a) || list.length >= MAX_RELAYERS || !ACCOUNT_RE.test(a) || a.length > 64) return;
    setList([...list, a]);
    setDraft("");
  };
  const draftBad = draft.trim() !== "" && (!ACCOUNT_RE.test(draft.trim().toLowerCase()) || draft.trim().length > 64);
  const changed = saved !== null && (saved.length !== list.length || saved.some((r, i) => r !== list[i]));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await callContract("set_relayers", { relayers: list }, 0n, 30n);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="relayers-title">
      <p className="kicker" id="relayers-title">Approved relayers</p>
      <p className="muted small" style={{ margin: "0 0 12px" }}>
        Accounts that can ask the contract to split your payouts, besides you and your host. They can only request splits the contract already allows. Up to {MAX_RELAYERS}.
      </p>
      {saved === null && !error && <Skeleton label="Reading your approved relayers…" lines={2} />}
      {saved !== null && (
        <>
          {list.length === 0 && <p className="note">None yet. Only you and your host can request a split.</p>}
          <ul className="utxos">
            {list.map((r) => (
              <li key={r}>
                <span className="mono">{r}</span>
                <button className="link-btn" onClick={() => setList(list.filter((x) => x !== r))} aria-label={`Remove ${r}`}>Remove</button>
              </li>
            ))}
          </ul>
          {list.length < MAX_RELAYERS && (
            <div className="field">
              <label htmlFor="relayer-add">Add a NEAR account</label>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input id="relayer-add" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="relayer.near" aria-invalid={draftBad} spellCheck={false} />
                <button className="btn-dark" onClick={add} disabled={!draft.trim() || draftBad}>Add</button>
              </div>
              {draftBad && <p className="help bad">That isn't a valid NEAR account name.</p>}
            </div>
          )}
          <div className="form-actions" style={{ marginTop: 16 }}>
            <button onClick={save} disabled={!changed || busy}>{busy ? "Waiting for your wallet\u2026" : "Save relayers"}</button>
          </div>
        </>
      )}
      {error != null && <ErrorNote error={error} />}
    </section>
  );
}

/** Frees the coins of a signed split that was never broadcast, so the payout can be split again. */
function ReleaseSplit({ account, onChanged }: { account: string; onChanged: () => void }) {
  const [id, setId] = useState("");
  const [split, setSplit] = useState<Split | null | undefined>(undefined);
  const [billPaid, setBillPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const look = async () => {
    setError(null);
    setDone(false);
    setSplit(undefined);
    setBillPaid(false);
    try {
      const sp = await getSplit(id.trim());
      if (sp?.bill_id) setBillPaid((await getBill(sp.bill_id))?.status === "Paid");
      setSplit(sp);
    } catch (e) {
      setError(e);
    }
  };
  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      await callContract("release_split", { split_id: id.trim() }, 0n, 30n);
      setDone(true);
      setSplit(await getSplit(id.trim()));
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const mine = split && split.miner === account;
  const releasable = mine && split.status === "Signed" && !billPaid;

  return (
    <section className="panel" aria-labelledby="release-title">
      <p className="kicker" id="release-title">Release an unused split</p>
      <p className="muted small" style={{ margin: "0 0 12px" }}>
        If a split was signed but never sent to Bitcoin, for example because it was built with a wrong amount, release it so those coins can be split again. Only do this for a split that isn't on Bitcoin.
      </p>
      <div className="field">
        <label htmlFor="release-id">Split number</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="release-id" inputMode="numeric" value={id} onChange={(e) => { setId(e.target.value.replace(/\D/g, "")); setSplit(undefined); setDone(false); }} placeholder="0" />
          <button className="btn-dark" onClick={look} disabled={!id}>Look up</button>
        </div>
      </div>
      {split === null && <p className="note">No split with that number.</p>}
      {split && (
        <dl className="kv-list" style={{ marginTop: 12 }}>
          <div className="kv"><dt>Status</dt><dd>{split.status}</dd></div>
          <div className="kv"><dt>Bitcoin transaction</dt><dd className="num"><a href={`${MEMPOOL_WEB}/tx/${split.txid}`} target="_blank" rel="noreferrer">{split.txid.slice(0, 12)}&hellip;</a></dd></div>
          {split.bill_id && <div className="kv"><dt>Pays bill</dt><dd>#{split.bill_id}</dd></div>}
        </dl>
      )}
      {split && !mine && <p className="note">This split belongs to another miner.</p>}
      {split && mine && billPaid && <p className="note">This split paid bill #{split.bill_id}, so it's on Bitcoin and can't be released.</p>}
      {split && mine && !billPaid && !releasable && !done && <p className="note">Only a signed split can be released. This one is {split.status.toLowerCase()}.</p>}
      {done && <p className="note note-lime">Released. Those coins can be split again.</p>}
      {releasable && !done && (
        <div className="form-actions" style={{ marginTop: 16 }}>
          <button className="btn-dark" onClick={release} disabled={busy}>{busy ? "Waiting for your wallet\u2026" : `Release split #${id}`}</button>
        </div>
      )}
      {error != null && <ErrorNote error={error} />}
    </section>
  );
}
