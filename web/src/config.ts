import { NETWORK, TEST_NETWORK } from "@scure/btc-signer";

const env = import.meta.env;
export const network: "mainnet" | "testnet" = env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";
const testnet = network === "testnet";

export const btcNetwork = testnet ? TEST_NETWORK : NETWORK;
export const CONTRACT_ID: string = env.VITE_RIGBILL_CONTRACT || (testnet ? "v1.rigbill.testnet" : "v1.rigbill.near");
export const SIGNER_ID: string = env.VITE_MPC_SIGNER || (testnet ? "v1.signer-prod.testnet" : "v1.signer");
export const NEAR_RPC: string = env.VITE_NEAR_RPC_URL || (testnet ? "https://rpc.testnet.near.org" : "https://rpc.mainnet.near.org");
export const ESPLORA: string = env.VITE_ESPLORA_URL || (testnet ? "https://blockstream.info/testnet4/api" : "https://mempool.space/api");
export const MEMPOOL_WEB = testnet ? "https://mempool.space/testnet4" : "https://mempool.space";
export const NEARBLOCKS_WEB = testnet ? "https://testnet.nearblocks.io" : "https://nearblocks.io";

/** Must match the contract's MINER_STORAGE_DEPOSIT and DEFAULT_FEE_CAP. */
export const MINER_STORAGE_DEPOSIT = 10n ** 22n;
export const DEFAULT_FEE_CAP = 3000;
/** Must match the contract's BILL_STORAGE_DEPOSIT. */
export const BILL_STORAGE_DEPOSIT = 10n ** 22n;
export const COINBASE_MATURITY = 100;
