import { useCallback, useEffect, useState } from "react";
import { payoutFromDerivedKey } from "./btc";
import { CONTRACT_ID } from "./config";
import { msg } from "./format";
import MinerHome from "./MinerHome";
import MinerSetup from "./MinerSetup";
import MinerBillDetail from "./MinerBillDetail";
import { usePath } from "./routing";
import { derivedPublicKey, getMiner, type Miner } from "./near";
import { ErrorBox, Skeleton } from "./ui";

/** /miner: S3 for a new account, S4 once registered. */
export default function MinerPage({ account }: { account: string }) {
  const path = usePath();
  const billId = path.match(/^\/miner\/bills\/(\d+)$/)?.[1];
  const [miner, setMiner] = useState<Miner | null | undefined>(undefined);
  const [payout, setPayout] = useState<{ pubkey: string; address: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([getMiner(account), derivedPublicKey(account)])
      .then(([m, k]) => { setMiner(m); setPayout(payoutFromDerivedKey(k)); setError(null); })
      .catch((e) => setError(msg(e)));
  }, [account]);
  useEffect(load, [load]);

  if (error) return <ErrorBox what={`Couldn't read ${CONTRACT_ID}`} error={error} retry={load} />;
  if (miner === undefined || !payout) return <Skeleton label={`Reading your setup from ${CONTRACT_ID}…`} lines={4} />;
  if (!miner) return <MinerSetup onDone={load} />;
  if (billId) return <MinerBillDetail account={account} id={billId} />;
  // The contract stores the key v1.signer gave it. A mismatch means: don't send funds.
  if (miner.payout_pubkey && miner.payout_pubkey !== payout.pubkey) {
    return <ErrorBox what="Don't send Bitcoin to this address" message="This payout address doesn't match the key NEAR's network derives for it. Report it at github.com/mystiquemide/Rigbill/issues." />;
  }
  return <MinerHome account={account} miner={miner} payout={payout} onChanged={load} />;
}
