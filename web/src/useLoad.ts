import { useCallback, useEffect, useRef, useState } from "react";
import { msg } from "./format";

/**
 * One read, as an explicit state machine:
 *
 *   loading ──ok──▶ ready ──reload──▶ refreshing ──ok──▶ ready
 *      │                                  └──fail──▶ stale (last data kept, error shown beside it)
 *      └──fail──▶ failed ──reload──▶ loading
 *
 * Changing `key` (a different bill, account or address) starts over at
 * loading, and any answer for an older key or an older request is dropped.
 */
export interface Load<T> {
  data: T | undefined;
  error: string | null;
  /** True while a request is in flight, including a refresh over existing data. */
  pending: boolean;
  reload: () => void;
  /** Replace the data directly, e.g. after polling found a newer value. */
  set: (data: T) => void;
}

export function useLoad<T>(key: string, fetch: () => Promise<T>): Load<T> {
  const [state, setState] = useState<{ key: string; data: T | undefined; error: string | null; pending: boolean }>({
    key: "",
    data: undefined,
    error: null,
    pending: true,
  });
  const seq = useRef(0);
  const fetchRef = useRef(fetch);
  useEffect(() => {
    fetchRef.current = fetch;
  });

  /** Sends the request; only the newest request for the current key may write. */
  const send = useCallback(() => {
    const mine = ++seq.current;
    fetchRef.current().then(
      (data) => mine === seq.current && setState({ key, data, error: null, pending: false }),
      (e) => mine === seq.current && setState((s) => ({ key, data: s.key === key ? s.data : undefined, error: msg(e), pending: false })),
    );
  }, [key]);

  useEffect(() => {
    send();
    // Invalidate in-flight requests when the key changes or the view unmounts.
    const counter = seq;
    return () => { counter.current++; };
  }, [send]);

  // Until the first answer for this key arrives, it's loading with no data.
  const current = state.key === key ? state : { key, data: undefined, error: null, pending: true };
  return {
    data: current.data,
    error: current.error,
    pending: current.pending,
    reload: () => {
      setState((s) => (s.key === key ? { ...s, pending: true } : s));
      send();
    },
    set: (data: T) => { seq.current++; setState({ key, data, error: null, pending: false }); },
  };
}

/** The current time, ticking every `everyMs`, so deadlines shown on screen move from live to expired on their own. */
export function useNow(everyMs = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
