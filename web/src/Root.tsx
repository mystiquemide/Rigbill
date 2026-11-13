import { AppShell } from "./AppShell";
import { HostView } from "./HostView";
import Landing from "./Landing";
import MinerPage from "./MinerPage";
import ProofPage from "./ProofPage";
import { usePath } from "./routing";

export default function Root() {
  const path = usePath();
  if (path === "/proof") return <ProofPage />;
  if (path.startsWith("/miner")) return <AppShell active="miner">{(a) => <MinerPage account={a} />}</AppShell>;
  if (path.startsWith("/host")) return <AppShell active="host">{(a) => <HostView account={a} />}</AppShell>;
  return <Landing />;
}
