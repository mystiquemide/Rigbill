import { useCallback, useEffect, useState } from "react";
import { CONTRACT_ID, MEMPOOL_WEB, NEARBLOCKS_WEB, network } from "./config";
import { getTipHeight, getTxStatus } from "./esplora";
import { msg, sats } from "./format";
import { getSplit, type Bill, type Split } from "./near";
import { swapStatus, type SwapStatusResponse } from "./oneclick";

interface State {
  split: Split | null;
  btc: { inMempool: boolean; confirmations: number } | null;
  swap: SwapStatusResponse | null;
  errors: string[];
}

const SWAP_LABEL: Record<string, string> = {
  KNOWN_DEPOSIT_TX: "1Click saw the deposit",
  PENDING_DEPOSIT: "1Click waiting for the deposit",
  INCOMPLETE_DEPOSIT: "1Click received less than quoted",
  PROCESSING: "1Click swapping to USDC",
  SUCCESS: "USDC delivered",
  REFUNDED: "1Click refunded the BTC to the payout address",
  FAILED: "1Click swap failed",
};

/** FR-012: the split's state from real sources: contract, Esplora and 1Click. */
export function SplitStatus({ bill }: { bill: Bill }) {
  const [s, setS] = useState<State | null>(null);

  const fetchState = useCallback(async (): Promise<State | null> => {
    if (!bill.split_id) return null;
    const errors: string[] = [];
    const split = await getSplit(bill.split_id).catch((e) => (errors.push(`contract: ${msg(e)}`), null));
    let btc: State["btc"] = null;
    if (split) {
      try {
        const [st, tip] = await Promise.all([getTxStatus(split.txid), getTipHeight()]);
        btc = { inMempool: st.inMempool, confirmations: st.confirmed && st.block_height ? tip - st.block_height + 1 : 0 };
      } catch (e) {
        errors.push(`chain: ${msg(e)}`);
      }
    }
    let swap: SwapStatusResponse | null = null;
    if (network === "mainnet" && bill.quote) {
      swap = await swapStatus(bill.quote.deposit_address).catch((e) => (errors.push(`1Click: ${msg(e)}`), null));
    }
    return { split, btc, swap, errors };
  }, [bill.split_id, bill.quote]);

  useEffect(() => {
    let alive = true;
    fetchState().then((st) => alive && setS(st));
    return () => {
      alive = false;
    };
  }, [fetchState]);
  const load = () => fetchState().then(setS);

  if (!bill.split_id) return null;
  if (!s) return <div className="small muted">Loading payment status...</div>;
  const { split, btc, swap, errors } = s;
  const dest = swap?.swapDetails?.destinationChainTxHashes?.[0];
  const hostOut = split?.outputs[0];

  return (
    <div className="timeline small">
      <div>
        <span className="dot on" /> Contract signed split #{bill.split_id}
        {split && ` (${split.status})`}
        {" · "}
        <a href={`${NEARBLOCKS_WEB}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">contract on nearblocks</a>
      </div>
      {split && (
        <div>
          <span className={btc && (btc.inMempool || btc.confirmations > 0) ? "dot on" : "dot"} />{" "}
          Bitcoin tx{" "}
          <a className="mono" href={`${MEMPOOL_WEB}/tx/${split.txid}`} target="_blank" rel="noreferrer">
            {split.txid.slice(0, 12)}...
          </a>
          {hostOut && ` paid ${sats(Number(hostOut.value))} to the deposit address`}
          {btc && (btc.confirmations > 0 ? `, ${btc.confirmations} confirmations` : btc.inMempool ? ", waiting for confirmation: 0 of 1" : ", not seen yet")}
        </div>
      )}
      {network === "mainnet" ? (
        <div>
          <span className={swap?.status === "SUCCESS" ? "dot on" : "dot"} /> {swap ? SWAP_LABEL[swap.status] ?? swap.status : "1Click status unknown"}
          {dest && (
            <>
              {" · "}
              <a href={dest.explorerUrl ?? `https://basescan.org/tx/${dest.hash}`} target="_blank" rel="noreferrer">Basescan</a>
            </>
          )}
        </div>
      ) : (
        <div className="muted"><span className="dot" /> Testnet: no 1Click swap. The host output went to the stand-in deposit address.</div>
      )}
      {errors.map((e) => <div key={e} className="err">{e}</div>)}
      <button className="ghost" onClick={load}>Refresh status</button>
    </div>
  );
}
