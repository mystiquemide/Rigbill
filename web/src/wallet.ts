import { NearConnector } from "@hot-labs/near-connect";
import { CONTRACT_ID, NEAR_RPC, network } from "./config";

/**
 * NEAR Connect (HOT, Meteor, Intear, NEAR Mobile, OKX and others). It replaced
 * Wallet Selector here after MyNearWallet stopped new app connections and
 * approvals in November 2026.
 */
let connector: NearConnector | null = null;

export function getConnector(): NearConnector {
  connector ??= new NearConnector({
    network,
    providers: { [network]: [NEAR_RPC] },
    footerBranding: null,
  });
  return connector;
}

/** Calls back with the signed-in account (or null) now and on every change. */
export function watchAccount(cb: (account: string | null) => void): () => void {
  const c = getConnector();
  const onIn = (e: { accounts: { accountId: string }[] }) => cb(e.accounts[0]?.accountId ?? null);
  const onOut = () => cb(null);
  c.on("wallet:signIn", onIn);
  c.on("wallet:signOut", onOut);
  c.getConnectedWallet()
    .then(({ accounts }) => cb(accounts[0]?.accountId ?? null))
    .catch(() => cb(null));
  return () => {
    c.off("wallet:signIn", onIn);
    c.off("wallet:signOut", onOut);
  };
}

export const signIn = () => getConnector().connect();
export const signOut = () => getConnector().disconnect();

/** A transaction the contract executed and refused. Carries the hash for an explorer link. */
export class ContractRefusal extends Error {
  readonly hash: string;
  constructor(failure: string, hash: string) {
    super(failure);
    this.hash = hash;
  }
}

function failureOf(outcome: any): string | null {
  const all = [outcome?.transaction_outcome, ...(outcome?.receipts_outcome ?? [])];
  for (const o of all) {
    const f = o?.outcome?.status?.Failure;
    if (f) return String(f?.ActionError?.kind?.FunctionCallError?.ExecutionError ?? JSON.stringify(f));
  }
  return outcome?.status?.Failure ? JSON.stringify(outcome.status.Failure) : null;
}

/** Signs and sends one contract call. Resolves with the tx hash, or throws ContractRefusal. */
export async function callContract(method: string, args: Record<string, unknown>, deposit: bigint, tgas = 60n): Promise<string> {
  const wallet = await getConnector().wallet();
  const outcome: any = await wallet.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName: method, args, gas: (tgas * 10n ** 12n).toString(), deposit: deposit.toString() },
      },
    ],
  });
  const hash: string = outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id ?? "";
  const failure = failureOf(outcome);
  if (failure) throw new ContractRefusal(failure, hash);
  return hash;
}
