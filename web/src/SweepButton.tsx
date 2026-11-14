import { useState } from "react";
import { SPLIT_STORAGE_DEPOSIT } from "./config";
import { getUtxos, type Utxo } from "./esplora";
import { sats } from "./format";
import type { Bill, Miner } from "./near";
import { ErrorNote, Skeleton } from "./ui";
import { useLoad } from "./useLoad";
import { callContract } from "./wallet";

const MAX_INPUTS = 4;
/** 1 input, 1 output P2WPKH at 2 sat/vB, the same estimate the relayer uses. */
const feeFor = (inputs: number) => Math.ceil(10.5 + 68 * inputs + 43) * 2;

/**
 * The invariant made visible: while a bill is open, the miner can try to send
 * everything to cold storage, and the contract refuses. The request goes to the
 * real contract with real UTXOs, and the refusal comes back from the chain.
 */
export function SweepButton({ account, miner, payoutAddress, bill }: { account: string; miner: Miner; payoutAddress: string; bill: Bill }) {
  const read = useLoad(`sweep:${payoutAddress}`, () => getUtxos(payoutAddress).then((u) => u.filter((x) => x.status.confirmed).slice(0, MAX_INPUTS)));
  const utxos: Utxo[] = read.data ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);


  const total = utxos.reduce((a, u) => a + u.value, 0);
  const coldValue = total - feeFor(utxos.length);

  const sweep = async () => {
    setBusy(true);
    setError(null);
    try {
      await callContract(
        "sign_split",
        {
          miner: account,
          inputs: utxos.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
          outputs: [{ address: miner.cold_address, value: String(coldValue) }],
        },
        SPLIT_STORAGE_DEPOSIT + BigInt(utxos.length),
        300n,
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel sweep" aria-labelledby="sweep-title">
      <p className="kicker" id="sweep-title">Send everything to my wallet</p>
      <p className="muted" style={{ margin: "16px 0 0", fontSize: 15 }}>
        Bill #{bill.id} is open, so the contract only signs payouts that pay it first. Try sending everything to your
        wallet and the contract refuses on chain.
      </p>
      {read.data === undefined && !read.error ? (
        <Skeleton label="Reading the payout address on Bitcoin…" lines={1} />
      ) : read.data === undefined ? (
        <p className="note">Couldn't read the payout address right now. <button className="link-btn" onClick={read.reload}>Try again</button></p>
      ) : utxos.length === 0 ? (
        <p className="note">Nothing confirmed at the payout address to send yet.</p>
      ) : coldValue < 546 ? (
        <p className="note">The confirmed balance is too small to cover a network fee.</p>
      ) : (
        <div className="actions">
          <button className="ghost" onClick={sweep} disabled={busy}>
            {busy ? "Waiting for your wallet\u2026" : `Send ${sats(coldValue)} to my cold wallet`}
          </button>
        </div>
      )}
      {error != null && <ErrorNote error={error} />}
    </section>
  );
}
