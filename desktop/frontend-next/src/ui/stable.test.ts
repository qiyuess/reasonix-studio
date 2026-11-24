import { describe, expect, it } from "vitest";
import { keepSame, keepSameBy, keepSameTree } from "./stable";

describe("identity reuse across a re-read", () => {
  it("keeps the array and its rows when nothing changed", () => {
    const cur = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
    expect(keepSame(cur, [{ id: "a", n: 1 }, { id: "b", n: 2 }])).toBe(cur);
  });

  it("replaces only the row whose fields changed", () => {
    const cur = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
    const next = [{ id: "a", n: 1 }, { id: "b", n: 3 }];
    const out = keepSame(cur, next);
    expect(out).not.toBe(cur);
    expect(out[0]).toBe(cur[0]);
    expect(out[1]).toBe(next[1]);
  });

  it("reuses a host list by name", () => {
    const cur = [{ name: "gpu", status: "connected" }];
    expect(keepSameBy("name", cur, [{ name: "gpu", status: "connected" }])).toBe(cur);
    expect(keepSameBy("name", cur, [{ name: "gpu", status: "degraded" }])).not.toBe(cur);
  });

  it("reuses a workspace and its sessions when a tree re-read found the same rows", () => {
    const session = { path: "/s/a", title: "a" };
    const cur = [{ root: "/w", name: "w", sessions: [session] }];
    const next = [{ root: "/w", name: "w", sessions: [{ path: "/s/a", title: "a" }] }];
    const out = keepSameTree(cur, next);
    expect(out).toBe(cur);
    expect(out[0].sessions[0]).toBe(session);
  });

  it("reuses the sessions of a workspace whose own field changed", () => {
    const session = { path: "/s/a", title: "a" };
    const cur = [{ root: "/w", name: "w", sessions: [session] }];
    const next = [{ root: "/w", name: "renamed", sessions: [{ path: "/s/a", title: "a" }] }];
    const out = keepSameTree(cur, next);
    expect(out).not.toBe(cur);
    expect(out[0].name).toBe("renamed");
    expect(out[0].sessions[0]).toBe(session);
  });

  it("replaces only the session row that changed", () => {
    const a = { path: "/s/a", title: "a" };
    const b = { path: "/s/b", title: "b" };
    const cur = [{ root: "/w", sessions: [a, b] }];
    const next = [{ root: "/w", sessions: [{ path: "/s/a", title: "a" }, { path: "/s/b", title: "B" }] }];
    const out = keepSameTree(cur, next);
    expect(out).not.toBe(cur);
    expect(out[0].sessions[0]).toBe(a);
    expect(out[0].sessions[1]).toBe(next[0].sessions[1]);
  });
});
