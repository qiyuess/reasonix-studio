import { describe, expect, it } from "vitest";
import type { TreeWorkspace } from "../port/hub";
import { groupFold, workspaceGroups } from "./workspaceGroups";

const project = (root: string, extra: Partial<TreeWorkspace> = {}): TreeWorkspace => ({
  root,
  name: root.replace(/^.*\//, ""),
  total: 0,
  remaining: 0,
  sessions: [],
  ...extra,
});

describe("the tree's two runs", () => {
  it("puts the app's own folder in the task run and every other folder in the project run", () => {
    const groups = workspaceGroups([project("/work/a"), project("/state/auto", { auto: true }), project("/work/b")]);
    expect(groups.projects.map((ws) => ws.root)).toEqual(["/work/a", "/work/b"]);
    expect(groups.tasks.map((ws) => ws.root)).toEqual(["/state/auto"]);
  });

  it("keeps the order it was handed, so the kernel's arrangement survives", () => {
    const groups = workspaceGroups([project("/work/z"), project("/work/a")]);
    expect(groups.projects.map((ws) => ws.root)).toEqual(["/work/z", "/work/a"]);
  });

  it("has an empty task run when no folder is the app's own", () => {
    expect(workspaceGroups([project("/work/a")]).tasks).toEqual([]);
  });
});

describe("a run's fold state", () => {
  const canFold = (ws: TreeWorkspace) => ws.sessions.length > 0;
  const rows = [project("/work/a", { sessions: [{ path: "a.jsonl", name: "a" }] }), project("/work/b", { sessions: [{ path: "b.jsonl", name: "b" }] })];

  it("is open while any row of the run is open", () => {
    expect(groupFold(rows, new Set(["/work/a"]), canFold).folded).toBe(false);
  });

  it("is folded only when every foldable row is", () => {
    const fold = groupFold(rows, new Set(["/work/a", "/work/b"]), canFold);
    expect(fold.folded).toBe(true);
    expect(fold.roots).toEqual(["/work/a", "/work/b"]);
  });

  it("cannot fold a run with nothing in it", () => {
    const fold = groupFold([project("/work/empty")], new Set(["/work/empty"]), canFold);
    expect(fold.canFold).toBe(false);
    expect(fold.folded).toBe(false);
  });
});
