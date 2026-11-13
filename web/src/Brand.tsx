import { Link } from "./Link";

/** The split mark: one payout in, the host's share first (lime), the rest to the miner. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <rect width="96" height="96" rx="22" fill="var(--lime)" />
      <path d="M48 16V42C48 54 34 58 30 80M48 42C48 54 62 58 66 80" stroke="var(--ground)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Rigbill home">
      <Mark />
      <span className="logo-word">rigbill</span>
    </Link>
  );
}
