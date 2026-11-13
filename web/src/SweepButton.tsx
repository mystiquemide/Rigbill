import { useEffect, useState } from "react";
import { SPLIT_STORAGE_DEPOSIT } from "./config";
import { getUtxos, type Utxo } from "./esplora";
import { sats } from "./format";
import { getOpenBill, type Bill, type Miner } from "./near";
import { ErrorNote } from "./ui";
import { callContract } from "./wallet";

const MAX_INPUTS = 4;
/** 1 input, 1 output P2WPKH at 2 sat/vB, the same estimate the relayer uses. */
const feeFor = (inputs: number) => Math.ceil(10.5 + 68 * inputs + 43) * 2;

/**
 * The invariant made visible: while a bill is open, the miner can try to send
 * everything to cold storage, and the contract refuses. The request goes to the
 * real contract with real UTXOs, and the refusal comes back from the chain.
 */
export function SweepButton({ account, miner, payoutAddress }: { account: string; miner: Miner; payoutAddress: string }) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [utxos, setUtxos] = useState<Utxo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    getOpenBill(account).then(setBill).catch(() => setBill(null));
    getUtxos(payoutAddress)
      .then((u) => setUtxos(u.filter((x) => x.status.confirmed).slice(0, MAX_INPUTS)))
      .catch(() => setUtxos([]));
  }, [account, payoutAddress]);

  if (!bill) return null;
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
    <section className="card">
      <h2>Sweep everything to cold</h2>
      <p className="small muted">
        Bill #{bill.id} is open, so the contract only signs splits that pay it first. Try sending the whole balance to
        your cold wallet instead and the contract will refuse on-chain.
      </p>
      {utxos.length === 0 ? (
        <p className="small muted">Nothing confirmed at the payout address to sweep yet.</p>
      ) : (
        <button className="ghost" onClick={sweep} disabled={busy || coldValue < 546}>
          {busy ? "Waiting for wallet..." : `Sweep ${sats(coldValue)} to cold`}
        </button>
      )}
      {error != null && <ErrorNote error={error} />}
    </section>
  );
}
