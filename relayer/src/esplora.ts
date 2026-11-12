const BASES = (process.env.ESPLORA_URL ?? "https://mempool.space/api,https://blockstream.info/api")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let last: unknown;
  for (const base of BASES) {
    try {
      const res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return res;
      const body = await res.text();
      // A 4xx is an answer about the request itself, so another host won't help.
      if (res.status >= 400 && res.status < 500) throw new Error(`Esplora ${res.status}: ${body}`);
      last = new Error(`Esplora ${base} ${res.status}: ${body}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Esplora 4")) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function getUtxos(address: string): Promise<Utxo[]> {
  return (await request(`/address/${address}/utxo`)).json();
}

export async function getTipHeight(): Promise<number> {
  return Number(await (await request("/blocks/tip/height")).text());
}

/** True if the tx is a coinbase (BR-004 maturity applies). */
export async function isCoinbase(txid: string): Promise<boolean> {
  const tx = await (await request(`/tx/${txid}`)).json();
  return Boolean(tx?.vin?.[0]?.is_coinbase);
}

export async function broadcast(txHex: string): Promise<string> {
  return (await request("/tx", { method: "POST", body: txHex })).text();
}
