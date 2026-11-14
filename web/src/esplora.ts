import { ESPLORA } from "./config";

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

async function get(path: string): Promise<Response> {
  const res = await fetch(ESPLORA + path, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Esplora ${res.status}`);
  return res;
}

export const getUtxos = async (address: string): Promise<Utxo[]> => (await get(`/address/${address}/utxo`)).json();
export const getTipHeight = async (): Promise<number> => Number(await (await get("/blocks/tip/height")).text());

export async function getTxStatus(txid: string): Promise<{ inMempool: boolean; confirmed: boolean; block_height?: number }> {
  const res = await fetch(`${ESPLORA}/tx/${txid}/status`, { signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return { inMempool: false, confirmed: false };
  if (!res.ok) throw new Error(`Esplora ${res.status}`);
  const st = await res.json();
  return { inMempool: !st.confirmed, confirmed: st.confirmed, block_height: st.block_height };
}

/** Current fee rate in sat/vB for confirmation within about 30 minutes. */
export async function getFeeRate(): Promise<number> {
  if (ESPLORA.includes("mempool.space") && !ESPLORA.includes("testnet")) {
    const r = await (await get("/v1/fees/recommended")).json();
    return r.halfHourFee;
  }
  const est: Record<string, number> = await (await get("/fee-estimates")).json();
  const rate = est["3"] ?? est["6"] ?? Math.min(...Object.values(est));
  return Math.max(1, Math.ceil(rate));
}
