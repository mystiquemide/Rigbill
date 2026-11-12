import { actionCreators, setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import { CONTRACT_ID, network } from "./config";

let ready: Promise<{ selector: WalletSelector; modal: WalletSelectorModal }> | null = null;

export function wallet() {
  ready ??= setupWalletSelector({ network, modules: [setupMyNearWallet()] }).then((selector) => ({
    selector,
    modal: setupModal(selector, { contractId: CONTRACT_ID }),
  }));
  return ready;
}

export async function callContract(method: string, args: Record<string, unknown>, deposit: bigint, tgas = 60n) {
  const { selector } = await wallet();
  const w = await selector.wallet();
  return w.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions: [actionCreators.functionCall(method, args, tgas * 10n ** 12n, deposit)],
  });
}
