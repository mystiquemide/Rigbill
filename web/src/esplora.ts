import { ESPLORA } from "./config";

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

async function get(path: string): Promise<Response> {
  const res = await fetch(ESPLORA + path);
  if (!res.ok) throw new Error(`Esplora ${res.status}`);
  return res;
}

export const getUtxos = async (address: string): Promise<Utxo[]> => (await get(`/address/${address}/utxo`)).json();
export const getTipHeight = async (): Promise<number> => Number(await (await get("/blocks/tip/height")).text());
