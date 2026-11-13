import App from "./App";
import Landing from "./Landing";
import ProofPage from "./ProofPage";
import { usePath } from "./routing";

export default function Root() {
  const path = usePath();
  if (path === "/proof") return <ProofPage />;
  if (path.startsWith("/miner") || path.startsWith("/host")) return <App />;
  return <Landing />;
}
