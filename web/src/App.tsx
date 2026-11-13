import { useCallback, useEffect, useState } from "react";
import { coldAddressError, payoutFromDerivedKey } from "./btc";
import {
  COINBASE_MATURITY,
  CONTRACT_ID,
  DEFAULT_FEE_CAP,
  MEMPOOL_WEB,
  MINER_STORAGE_DEPOSIT,
  NEARBLOCKS_WEB,
  network,
} from "./config";
import { getTipHeight, getUtxos, type Utxo } from "./esplora";
import { derivedPublicKey, getMiner, type Miner } from "./near";
import { callContract, signIn as connect, signOut as disconnect, watchAccount } from "./wallet";
import { ErrorBox, ErrorNote } from "./ui";
import { msg, sats, type Load } from "./format";
import { MinerBills } from "./MinerBills";
import { HostView } from "./HostView";
import { SweepButton } from "./SweepButton";
import { TxBanner } from "./TxBanner";


export default function App() {
  const [account, setAccount] = useState<string | null | undefined>(undefined);

  useEffect(() => watchAccount(setAccount), []);

  const signIn = () => {
    connect().catch(() => {});
  };
  const signOut = () => {
    disconnect().catch(() => {});
  };

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          Rigbill <span className="net">{network}</span>
        </div>
        {account ? (
          <div className="who">
            <span className="mono">{account}</span>
            <button className="ghost" onClick={signOut}>Sign out</button>
          </div>
        ) : account === null ? (
          <button onClick={signIn}>Sign in with NEAR</button>
        ) : null}
      </header>

      {account === undefined && <p className="muted">Loading wallet...</p>}
      {account === null && <Intro onSignIn={signIn} />}
      {account && <TxBanner account={account} />}
      {account && <RoleSwitch account={account} />}

      <footer className="foot muted">
        Contract{" "}
        <a href={`${NEARBLOCKS_WEB}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer" className="mono">
          {CONTRACT_ID}
        </a>
      </footer>
    </div>
  );
}

function RoleSwitch({ account }: { account: string }) {
  const [role, setRole] = useState<"miner" | "host">(location.hash === "#host" ? "host" : "miner");
  const pick = (r: "miner" | "host") => {
    setRole(r);
    history.replaceState(null, "", r === "host" ? "#host" : "#miner");
  };
  return (
    <>
      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={role === "miner"} className={role === "miner" ? "tab on" : "tab"} onClick={() => pick("miner")}>I mine</button>
        <button role="tab" aria-selected={role === "host"} className={role === "host" ? "tab on" : "tab"} onClick={() => pick("host")}>I host miners</button>
      </nav>
      {role === "miner" ? <MinerView account={account} /> : <HostView account={account} />}
    </>
  );
}

function Intro({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="card">
      <h1>Your hosting bill, paid from your mining payouts</h1>
      <p>
        Rigbill gives you a Bitcoin payout address that no person or server holds a key to. A NEAR contract controls it
        through Chain Signatures and only signs transactions that follow your rules: pay the host's open bill, send the
        rest to your cold wallet.
      </p>
      <button onClick={onSignIn}>Sign in with NEAR to set up</button>
    </section>
  );
}

function MinerView({ account }: { account: string }) {
  const [miner, setMiner] = useState<Load<Miner | null>>({ state: "loading" });
  const [payout, setPayout] = useState<Load<{ pubkey: string; address: string }>>({ state: "loading" });

  const refresh = useCallback(() => {
    getMiner(account)
      .then((data) => setMiner({ state: "ok", data }))
      .catch((e) => setMiner({ state: "error", error: msg(e) }));
    derivedPublicKey(account)
      .then((k) => setPayout({ state: "ok", data: payoutFromDerivedKey(k) }))
      .catch((e) => setPayout({ state: "error", error: msg(e) }));
  }, [account]);

  useEffect(refresh, [refresh]);

  if (miner.state === "loading") return <p className="muted">Reading your setup from {CONTRACT_ID}...</p>;
  if (miner.state === "error") return <ErrorBox what="Couldn't read the contract" error={miner.error} retry={refresh} />;

  const m = miner.data;
  // The contract stores the key it got from v1.signer. It must match the live derivation.
  const keyMismatch =
    m?.payout_pubkey && payout.state === "ok" && m.payout_pubkey !== payout.data.pubkey;

  return (
    <>
      {!m && <RegisterForm title="Set up your payout address" onDone={refresh} />}
      {m && (
        <>
          {keyMismatch ? (
            <ErrorBox what="Payout key mismatch" error="The contract's stored key differs from v1.signer. Don't send funds." />
          ) : (
            <PayoutCard payout={payout} pending={!m.payout_pubkey} onRetry={refresh} />
          )}
          <MinerBills account={account} />
          {payout.state === "ok" && <SweepButton account={account} miner={m} payoutAddress={payout.data.address} />}
          {payout.state === "ok" && <Balance address={payout.data.address} />}
          <Settings miner={m} onDone={refresh} />
        </>
      )}
    </>
  );
}

function PayoutCard({
  payout,
  pending,
  onRetry,
}: {
  payout: Load<{ pubkey: string; address: string }>;
  pending: boolean;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (payout.state === "loading") return <p className="muted">Deriving your payout address from the MPC network...</p>;
  if (payout.state === "error") return <ErrorBox what="Couldn't derive the payout address" error={payout.error} retry={onRetry} />;
  const { address } = payout.data;
  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <section className="card">
      <h2>Your payout address</h2>
      <p className="muted">Paste this into your pool's payout settings. Only the Rigbill contract can sign for it.</p>
      <div className="addr">
        <span className="mono">{address}</span>
        <button className="ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="small">
        <a href={`${MEMPOOL_WEB}/address/${address}`} target="_blank" rel="noreferrer">View on mempool.space</a>
        {pending && <span className="warn"> The contract is still recording this key. Refresh in a few seconds.</span>}
      </p>
    </section>
  );
}

function Balance({ address }: { address: string }) {
  const [data, setData] = useState<Load<{ utxos: Utxo[]; tip: number }>>({ state: "loading" });
  const load = useCallback(() => {
    Promise.all([getUtxos(address), getTipHeight()])
      .then(([utxos, tip]) => setData({ state: "ok", data: { utxos, tip } }))
      .catch((e) => setData({ state: "error", error: msg(e) }));
  }, [address]);
  useEffect(load, [load]);

  if (data.state === "loading") return <section className="card muted">Loading balance from mempool.space...</section>;
  if (data.state === "error") return <ErrorBox what="Couldn't load the balance" error={data.error} retry={load} />;
  const { utxos, tip } = data.data;
  const confirmed = utxos.filter((u) => u.status.confirmed).reduce((a, u) => a + u.value, 0);
  const pending = utxos.filter((u) => !u.status.confirmed).reduce((a, u) => a + u.value, 0);

  return (
    <section className="card">
      <div className="row">
        <h2>Balance</h2>
        <button className="ghost" onClick={() => { setData({ state: "loading" }); load(); }}>Refresh</button>
      </div>
      <div className="stats">
        <div><div className="big">{sats(confirmed)}</div><div className="muted small">confirmed</div></div>
        <div><div className="big">{sats(pending)}</div><div className="muted small">waiting for confirmation</div></div>
      </div>
      {utxos.length === 0 ? (
        <p className="muted">Nothing has arrived yet. Payouts sent to the address above show up here.</p>
      ) : (
        <table>
          <thead><tr><th>Payout</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {utxos.map((u) => (
              <tr key={`${u.txid}:${u.vout}`}>
                <td><a className="mono" href={`${MEMPOOL_WEB}/tx/${u.txid}`} target="_blank" rel="noreferrer">{u.txid.slice(0, 10)}...:{u.vout}</a></td>
                <td>{sats(u.value)}</td>
                <td>{u.status.confirmed && u.status.block_height ? `${tip - u.status.block_height + 1} confirmations` : "0 confirmations"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small muted">Coinbase payouts can't be spent until they're {COINBASE_MATURITY} blocks deep.</p>
    </section>
  );
}

function Settings({ miner, onDone }: { miner: Miner; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <RegisterForm title="Update your settings" initial={miner} onDone={() => { setEditing(false); onDone(); }} onCancel={() => setEditing(false)} />;
  return (
    <section className="card">
      <div className="row">
        <h2>Settings</h2>
        <button className="ghost" onClick={() => setEditing(true)}>Edit</button>
      </div>
      <dl>
        <dt>Cold wallet</dt>
        <dd><a className="mono" href={`${MEMPOOL_WEB}/address/${miner.cold_address}`} target="_blank" rel="noreferrer">{miner.cold_address}</a></dd>
        <dt>Fee cap per split</dt>
        <dd>{sats(Number(miner.fee_cap_sats))}</dd>
      </dl>
    </section>
  );
}

function RegisterForm({
  title,
  initial,
  onDone,
  onCancel,
}: {
  title: string;
  initial?: Miner;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [cold, setCold] = useState(initial?.cold_address ?? "");
  const [cap, setCap] = useState(String(initial ? Number(initial.fee_cap_sats) : DEFAULT_FEE_CAP));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const addrErr = coldAddressError(cold);
  const capNum = Number(cap);
  const capErr = !/^\d+$/.test(cap) || capNum < 200 || capNum > 100_000 ? "Fee cap must be a whole number from 200 to 100,000 sats." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (addrErr || capErr) return;
    setBusy(true);
    setError(null);
    try {
      await callContract(
        "register_miner",
        { cold_address: cold.trim(), fee_cap_sats: String(capNum) },
        initial ? 0n : MINER_STORAGE_DEPOSIT,
      );
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>{title}</h2>
      <label>
        Cold wallet address
        <input value={cold} onChange={(e) => setCold(e.target.value)} placeholder={network === "testnet" ? "tb1q..." : "bc1q..."} spellCheck={false} />
      </label>
      {touched && addrErr && <p className="err">{addrErr}</p>}
      <label>
        Fee cap per split (sats)
        <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="numeric" />
      </label>
      {touched && capErr && <p className="err">{capErr}</p>}
      <p className="small muted">
        Whatever isn't owed to your host goes to this address. The contract refuses any split whose network fee is above
        your cap.{!initial && " Registering locks 0.01 NEAR for storage."}
      </p>
      {error != null && <ErrorNote error={error} />}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? "Waiting for wallet..." : initial ? "Save" : "Register"}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
