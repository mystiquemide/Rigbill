import { NETWORK, TEST_NETWORK } from "@scure/btc-signer";

/** NETWORK=testnet runs on NEAR testnet + Bitcoin testnet4 (AMD-001). Default mainnet. */
export const network = (process.env.NETWORK || "mainnet") as "mainnet" | "testnet";
if (network !== "mainnet" && network !== "testnet") throw new Error(`NETWORK must be mainnet or testnet, got ${network}`);
const testnet = network === "testnet";

export const btcNetwork = testnet ? TEST_NETWORK : NETWORK;
export const CONTRACT_ID = process.env.RIGBILL_CONTRACT || (testnet ? "v1.rigbill.testnet" : "v1.rigbill.near");
export const SIGNER_ID = process.env.MPC_SIGNER || (testnet ? "v1.signer-prod.testnet" : "v1.signer");
export const NEAR_RPC_URL = process.env.NEAR_RPC_URL || (testnet ? "https://rpc.testnet.near.org" : "https://rpc.mainnet.near.org");
export const ESPLORA_URLS = (
  process.env.ESPLORA_URL ??
  (testnet
    ? "https://blockstream.info/testnet4/api,https://mempool.space/testnet4/api"
    : "https://mempool.space/api,https://blockstream.info/api")
)
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);
export const MEMPOOL_WEB = testnet ? "https://mempool.space/testnet4" : "https://mempool.space";
export const NEARBLOCKS_WEB = testnet ? "https://testnet.nearblocks.io" : "https://nearblocks.io";
