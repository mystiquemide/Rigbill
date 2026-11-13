import { useCallback, useEffect, useState } from "react";
import { CONTRACT_ID, network } from "./config";
import { runChecks, type Check } from "./proof";
import { SiteNav } from "./SiteNav";

const GROUPS: { key: Check["group"]; title: string }[] = [
  { key: "Contract", title: "1. Contract" },
  { key: "Payout address", title: "2. Payout address" },
  { key: "Bills", title: "3. Bills and the Bitcoin transactions that paid them" },
  { key: "Refusals", title: "4. Refusals" },
];

/** S8: every check from `npm run verify`, run live in the browser. */
export default function ProofPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [status, setStatus] = useState<"running" | "done" | "error">("running");
  const [error, setError] = useState("");
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const start = useCallback(() => {
    runChecks(setChecks)
      .then(() => { setStatus("done"); setRanAt(new Date()); })
      .catch((e) => { setStatus("error"); setError(e instanceof Error ? e.message : String(e)); });
  }, []);
  useEffect(start, [start]);
  const run = () => {
    setChecks([]);
    setStatus("running");
    start();
  };

  const failed = checks.filter((c) => !c.ok).length;
  return (
    <>
      <SiteNav />
      <main className="block">
        <div className="wrap">
          <div className="block-head">
            <div>
              <p className="kicker">Live proof, read in your browser</p>
              <h1 className="h1">Don't trust us, read the chain</h1>
            </div>
            <div style={{ maxWidth: 460 }}>
              <p className="muted" style={{ margin: "0 0 20px" }}>
                {ranAt ? `Checked ${ranAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : "Checking now"} against {CONTRACT_ID} on NEAR {network} and Bitcoin {network === "testnet" ? "testnet4" : "mainnet"}. The same checks run with npm run verify.
              </p>
              <button className="ghost" onClick={run} disabled={status === "running"}>
                {status === "running" ? `Checking… ${checks.length} done` : "Run checks again"}
              </button>
            </div>
          </div>

          {status === "error" && (
            <div className="panel" style={{ borderColor: "var(--lost)", marginBottom: 24 }} role="alert">
              <p style={{ margin: 0, color: "var(--lost)" }}>The checks stopped: {error}</p>
            </div>
          )}

          {GROUPS.map(({ key, title }) => {
            const rows = checks.filter((c) => c.group === key);
            if (rows.length === 0 && status !== "running") return null;
            return (
              <section key={key} className="panel checks" style={{ marginBottom: 24, paddingTop: 20 }} aria-label={title}>
                <h2 style={{ fontSize: 19, margin: "0 0 4px" }}>{title}</h2>
                {rows.length === 0 && <p className="skeleton">Reading NEAR and Bitcoin&hellip;</p>}
                {rows.map((c, i) => (
                  <div key={i} className="check">
                    <span className={`led${c.ok ? "" : " bad"}`} aria-label={c.ok ? "Passed" : "Failed"} />
                    <span>{c.label}</span>
                    <span className="detail">{c.href ? <a href={c.href} target="_blank" rel="noreferrer">{c.detail}</a> : c.detail}</span>
                  </div>
                ))}
              </section>
            );
          })}

          {status === "done" && (
            <p className="row" style={{ justifyContent: "flex-start", gap: 12 }}>
              <span className={`chip ${failed ? "chip-lost" : "chip-lime"}`}>{failed ? `${failed} of ${checks.length} checks failed` : `All ${checks.length} checks passed`}</span>
              <a className="arrow-link" href="https://github.com/mystiquemide/Rigbill/blob/main/relayer/src/verify.ts" target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>View the code that runs these checks</a>
            </p>
          )}
        </div>
      </main>
    </>
  );
}
