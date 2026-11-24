import { useCallback, useRef } from "react";

/** A function whose identity never changes and which always runs the latest one
 *  given: what a memoized child needs when the parent's callback closes over
 *  state that moves every render. */
export function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}

/** useStable per key: the same key always gets the same function, so a list of
 *  memoized children can each be handed a callback bound to its own id without a
 *  new closure on every render of the list. */
export function useStableFor<A extends unknown[], R>(fn: (key: string, ...args: A) => R): (key: string) => (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  const cache = useRef(new Map<string, (...args: A) => R>());
  return useCallback((key: string) => {
    let bound = cache.current.get(key);
    if (!bound) {
      bound = (...args: A) => latest.current(key, ...args);
      cache.current.set(key, bound);
    }
    return bound;
  }, []);
}

/** A reload that found the same panes must hand back the objects it already had:
 *  each pane is memoized on its runtime, and a new object per reload redraws every
 *  transcript for nothing. */
export function keepSame<T extends { id: string }>(cur: T[], next: T[]): T[] {
  return keepSameBy("id", cur, next);
}

/** keepSame for rows whose identity is another field. */
export function keepSameBy<T>(key: string, cur: T[], next: T[]): T[] {
  const reused = next.map((item) => {
    const value = (item as Record<string, unknown>)[key];
    const held = cur.find((c) => (c as Record<string, unknown>)[key] === value);
    return held && sameFields(held, item) ? held : item;
  });
  return sameArray(cur, reused) ? cur : reused;
}

/** A workspace is its root and a session is its path: a tree re-read that found
 *  the same rows hands back the objects it already had. */
export function keepSameTree<T extends { root: string; sessions: { path: string }[] }>(cur: T[], next: T[]): T[] {
  const reused = next.map((ws) => {
    const held = cur.find((c) => c.root === ws.root);
    if (!held) return ws;
    const sessions = keepSameBy("path", held.sessions, ws.sessions) as T["sessions"];
    if (!sameFields(held, ws, "sessions")) return { ...ws, sessions };
    return sessions === held.sessions ? held : { ...ws, sessions };
  });
  return sameArray(cur, reused) ? cur : reused;
}

function sameFields(a: unknown, b: unknown, except = ""): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  // A key only b carries with an undefined value is still a difference from
  // a lacking it entirely, so both key sets are read and a may be absent.
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  keys.delete(except);
  return [...keys].every((k) => x[k] === y[k]);
}

function sameArray<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && b.every((item, i) => item === a[i]);
}
