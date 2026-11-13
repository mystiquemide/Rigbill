import { useEffect, useState } from "react";

/** Minimal path router: real URLs for every screen, no dependency. */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}

export function navigate(to: string) {
  const [pathname, hash] = to.split("#");
  if (pathname && pathname !== location.pathname) {
    history.pushState(null, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
    scrollTo(0, 0);
  }
  if (hash) document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
}
