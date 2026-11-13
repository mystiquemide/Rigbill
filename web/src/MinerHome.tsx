import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { COINBASE_MATURITY, MEMPOOL_WEB, SIGNER_ID } from "./config";
import { getTipHeight, getUtxos, type Utxo } from "./esplora";
import { fmtDate, fmtTime, fromNs, msg, sats, usd } from "./format";
import { Link } from "./Link";
import { MinerForm } from "./MinerSetup";
import { getBillsForMiner, getOpenBill, getSplit, type Bill, type Miner, type Split } from "./near";
import { SplitStatus } from "./SplitStatus";
import { SweepButton } from "./SweepButton";
import { ErrorBox, StatusTag } from "./ui";

type Payout = { pubkey: string; address: string };

/** S4: everything a registered miner needs, read live from the contract and Bitcoin. */
export default function MinerHome({ account, miner, payout, onChanged }: { account: string; miner: Miner; payout: Payout; onChanged: () => void }) {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [open, setOpen] = useState<Bill | null>(null);
  const [billsError, setBillsError] = useState<string | null>(null);
  const loadBills = useCallback(() => {
    Promise.all([getBillsForMiner(account), getOpenBill(account)])
      .then(([b, o]) => { setBills(b); setOpen(o); setBillsError(null); })
      .catch((e) => setBillsError(msg(e)));
  }, [account]);
  useEffect(loadBills, [loadBills]);

  return (
    <div className="miner-home">
      <h1 className="sr-only">Your payouts</h1>
      <div className="grid-top">
        <PayoutCard address={payout.address} pending={!miner.payout_pubkey} />
        <BalancePanel address={payout.address} />
      </div>
      {billsError && <ErrorBox what="Couldn't read your bills" error={billsError} retry={loadBills} />}
      {open && <OpenBill bill={open} />}
      <div className="grid-mid">
        <History bills={bills} account={account} />
        {open ? <SweepButton account={account} miner={miner} payoutAddress={payout.address} bill={open} /> : <NoBillNote />}
      </div>
      <Settings miner={miner} payout={payout} onChanged={onChanged} />
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
    setQr(await QRCode.toString(`bitcoin:${address}`, { type: "svg", margin: 1, color: { dark: "#141d08", light: "#ecf2e0" } }));
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
  const [data, setData] = useState<{ utxos: Utxo[]; tip: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([getUtxos(address), getTipHeight()])
      .then(([utxos, tip]) => { setData({ utxos, tip }); setError(null); })
      .catch((e) => setError(msg(e)));
  }, [address]);
  useEffect(load, [load]);

  const confirmed = data?.utxos.filter((u) => u.status.confirmed).reduce((a, u) => a + u.value, 0) ?? 0;
  const waiting = data?.utxos.filter((u) => !u.status.confirmed).reduce((a, u) => a + u.value, 0) ?? 0;
  return (
    <section className="panel balance" aria-labelledby="balance-title" aria-live="polite">
      <div className="row"><p className="kicker" id="balance-title">Balance</p>{data && <button className="link-btn" onClick={load}>Refresh</button>}</div>
      {!data && !error && <p className="skeleton">Reading the payout address on Bitcoin&hellip;</p>}
      {error && <><p className="note note-warn">Couldn't reach Bitcoin data right now. Your funds are fine.</p><button className="ghost" onClick={load}>Try again</button></>}
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
  const [now] = useState(() => Date.now());
  const quoteLive = q && fromNs(q.deadline_ns).getTime() > now;
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
      {bill.status === "QuoteApproved" && quoteLive && <p className="note note-lime">Your next payout pays {sats(Number(q!.amount_in_sats))} to your host first. Everything above that goes to your wallet.</p>}
      {bill.status === "QuoteApproved" && !quoteLive && <p className="note note-warn">The locked quote has expired. Your host needs to lock a new one before the next payout can be split.</p>}
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
      {!bills && <p className="skeleton">Reading your bills from the contract&hellip;</p>}
      {bills?.length === 0 && <p className="note">No bills yet. When your host bills <span className="mono">{account}</span>, it shows up here with what it will cost.</p>}
      {bills?.map((b) => <HistoryRow key={b.id} bill={b} canAccept={!hasOpen} />)}
    </section>
  );
}

function HistoryRow({ bill, canAccept }: { bill: Bill; canAccept: boolean }) {
  const [split, setSplit] = useState<Split | null>(null);
  useEffect(() => {
    if (bill.split_id) getSplit(bill.split_id).then(setSplit).catch(() => setSplit(null));
  }, [bill.split_id]);
  const extra =
    bill.status === "Issued" ? <span className={canAccept ? "lime small" : "muted small"}>{canAccept ? "Review and accept" : "Waits for your open bill"}</span>
      : bill.status === "Paid" && split ? <span className="mono">split {split.txid.slice(0, 8)}&hellip;</span>
      : bill.status === "QuoteApproved" ? <span className="muted small">Waiting for a payout</span>
      : bill.status === "Accepted" ? <span className="muted small">Waiting for a quote</span>
      : bill.status === "Paying" ? <span className="muted small">Paying now</span>
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
