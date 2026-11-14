import { useEffect, useRef, useState } from "react";
import { MEMPOOL_WEB } from "./config";
import { proofFile, type PaidBill } from "./proof";

/**
 * A replay of the latest paid bill, read live from the contract and Bitcoin.
 * One payout lands, a sweep that skips the bill is refused, the split pays the
 * host first and the rest goes to the miner. The poster frame is the paid state.
 */
type Beat = 0 | 1 | 2 | 3 | 4;
const BEATS: [Beat, number][] = [[1, 900], [2, 3400], [3, 6200], [4, 9200]];
const LOOP_MS = 15500;

const sats = (n: number) => `${n.toLocaleString("en-US")} sats`;
const usd = (cents: string) => `$${(Number(cents) / 100).toFixed(2)}`;
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

function useReducedMotion() {
  const [r] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  return r;
}

/** Counts from the last value to the new one, so a balance moves instead of swapping. */
function Count({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="num">{sats(shown)}</span>;
}

export function PayoutStage({ paid }: { paid: PaidBill }) {
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState<Beat>(4);

  useEffect(() => {
    if (reduced) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      timers.forEach(clearTimeout);
      setBeat(0);
      timers = BEATS.map(([b, at]) => setTimeout(() => setBeat(b), at));
      timers.push(setTimeout(run, LOOP_MS));
    };
    const first = setTimeout(run, 2500); // hold the poster first, then start the replay
    return () => { clearTimeout(first); timers.forEach(clearTimeout); };
  }, [reduced]);

  const { bill, split, txid, fee } = paid;
  const [host, cold] = split.outputs;
  const total = split.outputs.reduce((a, o) => a + Number(o.value), 0) + (fee ?? 0);
  const refusal = proofFile?.refusals.find((r) => r.expect === "BILL_OPEN_HOST_OUTPUT_REQUIRED");
  const balance = beat === 0 ? 0 : beat < 3 ? total : 0;
  const billLabel = beat < 3 ? "Open" : beat === 3 ? "Paying" : "Paid";

  return (
    <figure className="stage" aria-label={`Replay of bill #${bill.id}: a payout of ${sats(total)} pays the host first, then the miner`}>
      <div className="stage-win">
        <div className="stage-bar">
          <span className="stage-dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="stage-title">Your payout address</span>
        </div>

        <div className="stage-body">
          <div className="stage-head">
            <div>
              <span className="stage-k">Payout address</span>
              <span className="mono stage-addr">{short(paid.address)}</span>
            </div>
            <div className="stage-bal">
              <span className="stage-k">Balance</span>
              <Count value={balance} />
            </div>
          </div>

          <div className={`stage-row in${beat >= 1 ? " on" : ""}`}>
            <span className="stage-ico" aria-hidden="true">↓</span>
            <span>Payout from your pool</span>
            <span className="num">+{sats(total)}</span>
          </div>

          <div className={`stage-row sweep${beat === 2 ? " on" : ""}`}>
            <span className="stage-ico" aria-hidden="true">→</span>
            <span>Send all to my wallet</span>
            <span className="stage-stamp">Refused</span>
            {refusal && <span className="stage-code mono">{refusal.expect}</span>}
          </div>

          <div className={`stage-split${beat >= 3 ? " on" : ""}`}>
            <div className="stage-line host">
              <span className="stage-k">To your host first</span>
              <span className="stage-swap">
                <span className={`num a${beat >= 4 ? " out" : ""}`}>{host ? sats(Number(host.value)) : ""}</span>
                <span className={`num b${beat >= 4 ? " in" : ""}`}>{usd(bill.usd_cents)} in USDC on Base</span>
              </span>
            </div>
            <div className="stage-line">
              <span className="stage-k">To your wallet</span>
              <span className="num">{cold ? sats(Number(cold.value)) : ""}</span>
            </div>
            <div className="stage-line muted">
              <span className="stage-k">Network fee</span>
              <span className="num">{fee != null ? sats(fee) : ""}</span>
            </div>
          </div>
        </div>

        <div className="stage-foot">
          <span>Bill #{bill.id} &middot; {usd(bill.usd_cents)} for {bill.period}</span>
          <span className={`stage-pill p-${billLabel.toLowerCase()}`}>{billLabel}</span>
        </div>
      </div>
      <figcaption className="stage-cap">
        A replay of bill #{bill.id}, read from mainnet.{" "}
        <a href={`${MEMPOOL_WEB}/tx/${txid}`} target="_blank" rel="noreferrer">See the Bitcoin transaction</a>
      </figcaption>
    </figure>
  );
}
