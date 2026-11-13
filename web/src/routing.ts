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

/** Waits for an element that a route change is about to render, then scrolls to it. */
function scrollToId(id: string, tries = 40) {
  const el = document.getElementById(id);
  if (el) return el.scrollIntoView({ behavior: "smooth" });
  if (tries > 0) requestAnimationFrame(() => scrollToId(id, tries - 1));
}

export function navigate(to: string) {
  const [pathname, hash] = to.split("#");
  const target = pathname || location.pathname;
  if (target !== location.pathname || (hash ?? "") !== location.hash.slice(1)) {
    history.pushState(null, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
  }
  if (hash) scrollToId(hash);
  else scrollTo({ top: 0 });
}
