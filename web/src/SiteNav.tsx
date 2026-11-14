import { useEffect, useState } from "react";
import { Logo } from "./Brand";
import { Link } from "./Link";
import { usePath } from "./routing";

/** Marketing nav for / and /proof. Every link goes somewhere different; on phones they fold into one menu. */
export function SiteNav() {
  const path = usePath();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [open]);
  const links = [
    { to: "/#how", label: "How it works", current: false },
    { to: "/miner", label: "For miners", current: false },
    { to: "/host", label: "For hosts", current: false },
    { to: "/proof", label: "Proof", current: path === "/proof" },
  ];
  const done = () => setOpen(false);
  return (
    <header className="site-nav on-dark">
      <div className="wrap">
        <Logo />
        <nav aria-label="Main" className="site-links">
          {links.map((l) => (
            <Link key={l.to} to={l.to} aria-current={l.current ? "page" : undefined}>{l.label}</Link>
          ))}
          <Link to="/miner" className="btn">Open app</Link>
        </nav>
        <button className="menu-btn ghost" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && (
        <nav id="site-menu" className="site-menu" aria-label="Main">
          {links.map((l) => (
            <Link key={l.to} to={l.to} onClick={done} aria-current={l.current ? "page" : undefined}>{l.label}</Link>
          ))}
          <Link to="/miner" className="btn" onClick={done}>Open app</Link>
        </nav>
      )}
    </header>
  );
}
