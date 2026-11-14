import { useEffect, useState, type ReactNode } from "react";
import { CONTRACT_ID, NEARBLOCKS_WEB, network } from "./config";
import { Logo } from "./Brand";
import { Link } from "./Link";
import { TxBanner } from "./TxBanner";
import { signIn, signOut, watchAccount } from "./wallet";

type Tab = "miner" | "host" | "proof";

/** Shared app chrome for every signed-in screen (S3 to S7). */
export function AppShell({ active, children }: { active: Tab; children: (account: string) => ReactNode }) {
  const [account, setAccount] = useState<string | null | undefined>(undefined);
  useEffect(() => watchAccount(setAccount), []);
  const connect = () => void signIn().catch(() => {});

  return (
    <>
      <header className="app-nav on-dark">
        <div className="wrap">
          <Logo />
          <nav className="app-tabs" aria-label="App">
            <Link to="/miner" className={active === "miner" ? "on" : ""} aria-current={active === "miner" ? "page" : undefined}>Miner</Link>
            <Link to="/host" className={active === "host" ? "on" : ""} aria-current={active === "host" ? "page" : undefined}>Host</Link>
            <Link to="/proof" className={active === "proof" ? "on" : ""}>Proof</Link>
          </nav>
          <div className="app-who">
            <span className={`chip ${network === "testnet" ? "chip-review" : "chip-lime"}`}>{network}</span>
            {account && <span className="mono">{account}</span>}
            {account && <button className="link-btn" onClick={() => void signOut().catch(() => {})}>Sign out</button>}
            {account === null && <button onClick={connect}>Connect wallet</button>}
          </div>
        </div>
      </header>
      <main className="app-body">
        <div className="wrap">
          {account === undefined && <p className="skeleton">Checking for a connected wallet&hellip;</p>}
          {account === null && <SignInPrompt active={active} onConnect={connect} />}
          {account && <TxBanner account={account} />}
          {account && children(account)}
        </div>
      </main>
      <footer className="app-foot">
        <div className="wrap">
          <span className="muted small">Contract <a className="mono" href={`${NEARBLOCKS_WEB}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">{CONTRACT_ID}</a></span>
          <Link to="/proof" className="small">Proof</Link>
        </div>
      </footer>
    </>
  );
}

function SignInPrompt({ active, onConnect }: { active: Tab; onConnect: () => void }) {
  const host = active === "host";
  return (
    <section className="panel signin">
      <p className="kicker">{host ? "For hosts" : "For miners"}</p>
      <h1 className="h2">{host ? <>Bill your miners in dollars, get USDC on Base</> : <>Set up your payout address and keep your own keys</>}</h1>
      <p className="muted">
        {host
          ? "Sign in with your NEAR wallet to issue bills, lock quotes and confirm payments."
          : "Sign in with your NEAR wallet. It only signs the actions you click, and Rigbill never holds your Bitcoin."}
      </p>
      <button onClick={onConnect}>Sign in with NEAR</button>
    </section>
  );
}
