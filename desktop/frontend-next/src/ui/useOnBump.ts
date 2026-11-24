import { useEffect, useRef } from "react";

/** Runs `fn` when `count` changes after mount. A counter is how a request made
 *  twice stays two requests, and mounting is not one. The fn is read through a
 *  ref: excluding it from the effect's deps keeps one bump one call even when
 *  the caller hands a fresh closure, and reading it fresh keeps that call the
 *  latest closure rather than the one the effect captured. */
export function useOnBump(count: number, fn: () => void): void {
  const seen = useRef(count);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (seen.current === count) return;
    seen.current = count;
    latest.current();
  }, [count]);
}
