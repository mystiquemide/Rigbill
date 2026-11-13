import { useEffect, useState } from "react";
import { coldAddressError } from "./btc";
import { DEFAULT_FEE_CAP, MINER_STORAGE_DEPOSIT, network } from "./config";
import { getFeeRate } from "./esplora";
import { btcPriceUsd } from "./oneclick";
import { ErrorNote } from "./ui";
import { callContract } from "./wallet";
import type { Miner } from "./near";

/** A normal split is one or two inputs and two outputs, about 154 to 222 vbytes. */
const SPLIT_VBYTES = [154, 222];

/** Live fee context for the fee cap field: today's rate and what the cap is worth. */
function useFeeContext() {
  const [rate, setRate] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    getFeeRate().then(setRate).catch(() => setRate(null));
    btcPriceUsd().then(setPrice).catch(() => setPrice(null));
  }, []);
  return { rate, price };
}

function feeHelper(cap: number, rate: number | null, price: number | null): string {
  const parts: string[] = [];
  if (price && cap > 0) parts.push(`About $${((cap / 1e8) * price).toFixed(2)} today.`);
  if (rate) parts.push(`Bitcoin fees are ${rate} sat/vB right now, so a normal split costs ${(rate * SPLIT_VBYTES[0]).toLocaleString("en-US")} to ${(rate * SPLIT_VBYTES[1]).toLocaleString("en-US")} sats.`);
  return parts.join(" ") || "The contract refuses any split whose network fee is above this cap.";
}

function capError(cap: string): string | null {
  const n = Number(cap.replace(/,/g, ""));
  return /^\d[\d,]*$/.test(cap) && n >= 200 && n <= 100_000 ? null : "Use a whole number from 200 to 100,000 sats.";
}

/** S3, and the edit form for S4 settings. */
export function MinerForm({ initial, onDone, onCancel }: { initial?: Miner; onDone: () => void; onCancel?: () => void }) {
  const [cold, setCold] = useState(initial?.cold_address ?? "");
  const [cap, setCap] = useState(String(initial ? Number(initial.fee_cap_sats) : DEFAULT_FEE_CAP));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { rate, price } = useFeeContext();
  const prefix = network === "testnet" ? "tb1" : "bc1";

  const addrErr = coldAddressError(cold);
  const capErr = capError(cap);
  const capNum = Number(cap.replace(/,/g, ""));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (addrErr || capErr) return;
    setBusy(true);
    setError(null);
    try {
      await callContract("register_miner", { cold_address: cold.trim(), fee_cap_sats: String(capNum) }, initial ? 0n : MINER_STORAGE_DEPOSIT);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="cold">Cold wallet address</label>
        <input id="cold" value={cold} onChange={(e) => setCold(e.target.value)} spellCheck={false} autoComplete="off" aria-invalid={touched && !!addrErr} aria-describedby="cold-help" />
        <p id="cold-help" className={touched && addrErr ? "help bad" : "help"}>
          {touched && addrErr ? addrErr : `Your own Bitcoin wallet. Native segwit addresses starting with ${prefix} work.`}
        </p>
      </div>
      <div className="field">
        <label htmlFor="cap">Most you'll pay in network fees per payout (sats)</label>
        <input id="cap" value={cap} onChange={(e) => setCap(e.target.value)} inputMode="numeric" aria-invalid={touched && !!capErr} aria-describedby="cap-help" />
        <p id="cap-help" className={touched && capErr ? "help bad" : "help"}>{touched && capErr ? capErr : feeHelper(capNum, rate, price)}</p>
      </div>
      {error != null && <ErrorNote error={error} />}
      <div className="form-actions">
        <button type="submit" disabled={busy}>{busy ? "Waiting for your wallet…" : initial ? "Save settings" : "Create my payout address"}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
      <p className="help">{initial ? "Your wallet asks you to approve the change." : "Locks 0.01 NEAR for storage. Your wallet asks you to approve."}</p>
    </form>
  );
}

export default function MinerSetup({ onDone }: { onDone: () => void }) {
  return (
    <div className="setup">
      <div>
        <p className="kicker">Step 1 of 2</p>
        <h1 className="h2">Where should your Bitcoin go?</h1>
        <p className="lead">Everything not owed to your host goes to this wallet. You keep its keys. Rigbill never does.</p>
        <MinerForm onDone={onDone} />
      </div>
      <aside className="panel next-steps" aria-label="What happens next">
        <h2>What happens next</h2>
        <ol>
          <li><span className="n">01</span>NEAR's MPC network derives a Bitcoin address that belongs to this contract and your account.</li>
          <li><span className="n">02</span>You paste that address into your pool's payout settings.</li>
          <li><span className="n">03</span>When your host bills you, you choose the most it can cost.</li>
        </ol>
      </aside>
    </div>
  );
}
