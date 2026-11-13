import { useEffect, useState } from "react";
import { NEARBLOCKS_WEB } from "./config";
import { explain, msg } from "./format";
import { txResult } from "./near";

type Banner =
  | { kind: "checking"; hash: string }
  | { kind: "ok"; hash: string }
  | { kind: "refused"; hash: string; text: string }
  | { kind: "cancelled" }
  | { kind: "error"; text: string };

/**
 * MyNearWallet returns here with ?transactionHashes=... (or ?errorCode=...).
 * The outcome is read from NEAR RPC, so a contract refusal shows its real
 * error code and a nearblocks link instead of a generic wallet message.
 */
export function TxBanner({ account }: { account: string }) {
  const [banner, setBanner] = useState<Banner | null>(() => {
    const q = new URLSearchParams(location.search);
    const hash = q.get("transactionHashes")?.split(",").pop();
    if (hash) return { kind: "checking", hash };
    if (q.get("errorCode")) return q.get("errorCode") === "userRejected" ? { kind: "cancelled" } : { kind: "error", text: q.get("errorMessage") ?? q.get("errorCode")! };
    return null;
  });

  useEffect(() => {
    if (location.search) history.replaceState(null, "", location.pathname + location.hash);
  }, []);

  const pending = banner?.kind === "checking" ? banner.hash : null;
  useEffect(() => {
    if (!pending) return;
    txResult(pending, account)
      .then((r) => setBanner(r.ok ? { kind: "ok", hash: pending } : { kind: "refused", hash: pending, text: explain(r.failure) }))
      .catch((e) => setBanner({ kind: "error", text: `Couldn't read the transaction result: ${msg(e)}` }));
  }, [pending, account]);

  if (!banner) return null;
  const link = "hash" in banner && (
    <a href={`${NEARBLOCKS_WEB}/txns/${banner.hash}`} target="_blank" rel="noreferrer">View on nearblocks</a>
  );
  return (
    <section className={`card banner ${banner.kind === "refused" || banner.kind === "error" ? "error" : ""}`} role="status">
      {banner.kind === "checking" && <span>Checking the transaction result... {link}</span>}
      {banner.kind === "ok" && <span>Transaction confirmed. {link}</span>}
      {banner.kind === "refused" && (
        <span>
          <strong>{banner.text}</strong> No signature was produced, so no Bitcoin transaction can follow. {link}
        </span>
      )}
      {banner.kind === "cancelled" && <span>You cancelled in the wallet. Nothing was sent.</span>}
      {banner.kind === "error" && <span>{banner.text}</span>}
      <button className="ghost" onClick={() => setBanner(null)}>Dismiss</button>
    </section>
  );
}
