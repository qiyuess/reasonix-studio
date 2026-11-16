import { describe, expect, it } from "vitest";
import { foldersOf, treeRows } from "./workbench_tree";

// The tree draws a folder for every path segment a file implies, not only the
// folders the listing named. Anything that decides which folders are closed has
// to read the same set, or a folder known only from a path is drawn open.
describe("the folders a tree will draw", () => {
  it("includes what the listing named", () => {
    expect(foldersOf([], ["internal", "scripts"]).sort()).toEqual(["internal", "scripts"]);
  });

  it("includes the parents a file path implies", () => {
    // `a/b/c.go` needs `a` and `a/b` drawn even when the listing named neither.
    expect(foldersOf(["a/b/c.go"], []).sort()).toEqual(["a", "a/b"]);
  });

  it("names each folder once however many files sit under it", () => {
    expect(foldersOf(["a/b/c.go", "a/b/d.go", "a/e.go"], []).sort()).toEqual(["a", "a/b"]);
  });
});

describe("a tree nobody has opened", () => {
  const files = ["internal/provider/retry.go", "README.md"];
  const dirs = ["internal", "internal/provider"];

  it("draws only the top level, with every folder closed", () => {
    const closed = new Set(foldersOf(files, dirs));
    const rows = treeRows(files, dirs, "", closed);
    expect(rows.map((r) => `${r.kind}:${r.path}`)).toEqual([
      "folder:internal",
      "file:README.md",
    ]);
  });

  it("keeps a nested file hidden until its folder is opened", () => {
    const closed = new Set(foldersOf(files, dirs));
    const rows = treeRows(files, dirs, "", closed);
    expect(rows.some((r) => r.path === "internal/provider/retry.go")).toBe(false);
  });

  it("opens the folder the reader clicked, and shows its children closed", () => {
    const closed = new Set(foldersOf(files, dirs));
    closed.delete("internal");
    const rows = treeRows(files, dirs, "", closed);
    expect(rows.map((r) => `${r.kind}:${r.path}`)).toContain("folder:internal/provider");
    // The grandchild folder is still closed, so its own file stays hidden.
    expect(rows.some((r) => r.path === "internal/provider/retry.go")).toBe(false);
  });

  it("draws every level while a search is running, so a match cannot hide", () => {
    // A search passes an empty closed set on purpose: its rows are matches.
    const rows = treeRows(files, dirs, "retry", new Set());
    expect(rows.some((r) => r.path === "internal/provider/retry.go")).toBe(true);
  });
});
