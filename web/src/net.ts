import { network } from "./config";

const env = import.meta.env;
const testnet = network === "testnet";

/** Public endpoints, tried in order. A visitor whose network blocks or slows one still gets an answer. */
export const NEAR_RPCS: string[] = env.VITE_NEAR_RPC_URL
  ? [env.VITE_NEAR_RPC_URL]
  : testnet
    ? ["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"]
    : ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"];
/** Regular nodes drop transactions after a few days. Archival nodes keep them all. */
const NEAR_ARCHIVAL = testnet ? "https://archival-rpc.testnet.near.org" : "https://archival-rpc.mainnet.near.org";
export const ESPLORAS: string[] = env.VITE_ESPLORA_URL
  ? [env.VITE_ESPLORA_URL]
  : testnet
    ? ["https://blockstream.info/testnet4/api", "https://mempool.space/testnet4/api"]
    : ["https://mempool.space/api", "https://blockstream.info/api"];

const TIMEOUT_MS = 20000;
const retryable = (status: number) => status === 429 || status >= 500;

/** One call, tried twice per endpoint, then on the next endpoint. A 4xx answer counts as an answer. */
async function tryEach(urls: string[], call: (url: string) => Promise<Response>): Promise<Response> {
  let last: unknown = new Error("No endpoint");
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await call(url);
        if (!retryable(res.status)) return res;
        last = new Error(`${new URL(url).host} ${res.status}`);
      } catch (e) {
        last = e;
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** NEAR JSON-RPC. Returns the parsed body, errors included, so callers can read contract panics. */
export async function nearRpc(method: string, params: unknown): Promise<any> {
  // Transaction lookups go to the archival node first: regular nodes take over 30 s to give up on one they've pruned.
  const urls = method === "tx" && !env.VITE_NEAR_RPC_URL ? [NEAR_ARCHIVAL, ...NEAR_RPCS] : NEAR_RPCS;
  const res = await tryEach(urls, (url) =>
    fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "rigbill", method, params }),
    }),
  );
  if (!res.ok) throw new Error(`NEAR RPC ${res.status}`);
  return res.json();
}

/** Esplora GET. Returns the response, so a 404 can mean "not found yet". */
export function esplora(path: string): Promise<Response> {
  return tryEach(ESPLORAS, (base) => fetch(base + path, { signal: AbortSignal.timeout(TIMEOUT_MS) }));
}
