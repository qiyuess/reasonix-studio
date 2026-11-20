// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { Workspaces } from "./Workspaces";
import type { TreeSession, TreeWorkspace } from "../port/hub";
import type { SessionScope } from "./sessionScope";

vi.mock("../port/host", () => ({ host: () => ({ revealsFiles: () => true }) }));

afterEach(cleanup);

function draw(over: Partial<TreeWorkspace> = {}, sessions: Record<string, TreeSession[]> = {}, extra: { previewLimit?: number; scope?: SessionScope } = {}) {
  const tree: TreeWorkspace[] = ["a", "b"].map((name) => ({
    root: "/" + name, name, remembered: true, sessions: sessions[name] ?? [], ...over,
  }));
  const revealWorkspace = vi.fn().mockResolvedValue(undefined);
  const removeWorkspace = vi.fn().mockResolvedValue(undefined);
  const setWorkspacePinned = vi.fn().mockResolvedValue(undefined);
  const setWorkspaceDisplayName = vi.fn().mockResolvedValue(undefined);
  const archiveWorkspace = vi.fn().mockResolvedValue(undefined);
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const reload = vi.fn().mockResolvedValue(undefined);
  const onFold = vi.fn();
  const onOpen = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  render(<Workspaces hub={{ revealWorkspace, removeWorkspace, setWorkspacePinned, setWorkspaceDisplayName, archiveWorkspace, openWithTargets: async () => [] } as never} tree={tree} treeRead
    runtimes={[]} active="" folded={new Set()} onFold={onFold} reload={reload} onOpen={onOpen}
    previewLimit={extra.previewLimit} scope={extra.scope}
    onFocus={() => {}} onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}}
    onArchive={onArchive} onError={onError} adder={{ add: () => {}, close: () => {}, at: null } as never} />);
  const row = (name: string) => screen.getByText(name, { selector: ".wsname" }).closest<HTMLElement>('[role="treeitem"]')!;
  return { row, revealWorkspace, removeWorkspace, setWorkspacePinned, archiveWorkspace, onArchive, reload, onFold, onOpen, onError };
}

it("opens the existing project menu from a right click without folding or opening a session", () => {
  const { row, onFold, onOpen } = draw();
  expect(fireEvent.contextMenu(row("b"), { clientX: 120, clientY: 90 })).toBe(false);
  expect(screen.getByRole("menu", { name: "项目操作" })).toBeTruthy();
  // Renaming leads the menu: moving a project is the row's own drag.
  expect(screen.getByRole("menuitem", { name: "重命名项目" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "重命名项目" }));
  expect(screen.queryByRole("menuitem", { name: "上移" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "下移" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: /在文件管理器中显示/ })).toBeTruthy();
  expect(onFold).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
});

it.each(["{ContextMenu}", "{Shift>}{F10}{/Shift}"])("opens from %s and restores row focus on Escape", async (key) => {
  const { row } = draw();
  row("b").focus();
  await userEvent.keyboard(key);
  expect(screen.getByRole("menu", { name: "项目操作" })).toBeTruthy();
  await userEvent.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /移除/ }));
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(row("b"));
});

it("reveals the right-clicked project and returns focus to its row", async () => {
  const { row, revealWorkspace } = draw();
  fireEvent.contextMenu(row("b"));
  await userEvent.click(screen.getByRole("menuitem", { name: /在文件管理器中显示/ }));
  expect(revealWorkspace).toHaveBeenCalledExactlyOnceWith("/b");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(row("b"));
});

it("reuses the removal confirmation from the context menu", async () => {
  const { row, removeWorkspace } = draw();
  // Movement left the menu for the row's own drag (workspace-drag covers the
  // walk and its reload); the confirm stays the menu's own work.
  fireEvent.contextMenu(row("b"));
  await userEvent.click(screen.getByRole("menuitem", { name: /移除/ }));
  expect(screen.getByRole("alertdialog").textContent).toContain("从列表移除「b」？");
  expect(removeWorkspace).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "移除" }));
  await waitFor(() => expect(removeWorkspace).toHaveBeenCalledExactlyOnceWith("/b"));
});

it("switches the context menu to another project and preserves normal row and add clicks", async () => {
  const { row, revealWorkspace, onFold, onOpen } = draw();
  fireEvent.contextMenu(row("a"));
  fireEvent.contextMenu(row("b"));
  expect(screen.getAllByRole("menu")).toHaveLength(1);
  await userEvent.click(screen.getByRole("menuitem", { name: /在文件管理器中显示/ }));
  expect(revealWorkspace).toHaveBeenCalledExactlyOnceWith("/b");
  await userEvent.click(row("a"));
  expect(onFold).not.toHaveBeenCalled();
  expect(row("a").hasAttribute("aria-expanded")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "在 b 下新建会话" }));
  expect(onOpen).toHaveBeenCalledExactlyOnceWith({ root: "/b" });
  expect(screen.queryByRole("menu")).toBeNull();
});

it("keeps unavailable actions disabled and reports reveal failures", async () => {
  const missing = draw({ missing: true });
  fireEvent.contextMenu(missing.row("b"));
  expect((screen.getByRole("menuitem", { name: /在文件管理器中显示/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(missing.revealWorkspace).not.toHaveBeenCalled();
  cleanup();
  const { row, revealWorkspace, onError } = draw();
  const refusal = new Error("folder unavailable");
  revealWorkspace.mockRejectedValueOnce(refusal);
  fireEvent.contextMenu(row("b"));
  await userEvent.click(screen.getByRole("menuitem", { name: /在文件管理器中显示/ }));
  await waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(refusal));
});

it("offers a project no way into picking, which is a conversation's action", () => {
  const pane = draw({}, {
    a: [{ path: "/a/x.jsonl", name: "x", title: "X" }, { path: "/a/y.jsonl", name: "y", title: "Y" }],
    b: [{ path: "/b/z.jsonl", name: "z", title: "Z" }],
  });
  fireEvent.contextMenu(pane.row("a"));
  expect(screen.queryByRole("menuitem", { name: /批量管理/ })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: /复制项目目录/ })).toBeNull();
  expect(document.querySelector(".session-batch")).toBeNull();
  expect(pane.onOpen).not.toHaveBeenCalled();
});

it("pins through the kernel and re-reads the tree", async () => {
  const { row, setWorkspacePinned, reload } = draw();
  fireEvent.contextMenu(row("b"));
  await userEvent.click(screen.getByRole("menuitem", { name: "置顶项目" }));
  await waitFor(() => expect(setWorkspacePinned).toHaveBeenCalledWith("/b", true));
  expect(reload).toHaveBeenCalled();
});

// A project reads by the name the person gave it, so the field that edits that
// name starts from what the sidebar shows — not from the folder's basename,
// which would silently overwrite the name they chose.
it("renames starting from the name the sidebar shows", async () => {
  draw({ displayName: "My Project" });
  // Every row carries the display name, so the menu is opened from the second
  // project's own more-actions trigger rather than by its text.
  fireEvent.contextMenu(screen.getAllByRole("button", { name: /项目操作/ })[1]);
  await userEvent.click(screen.getByRole("menuitem", { name: "重命名项目" }));
  expect((await screen.findByLabelText("项目名称") as HTMLInputElement).value).toBe("My Project");
});

// The card's style is position:fixed and it portals to the end of the document,
// so with no top or left written it sits at the page's own bottom edge — below
// the fold of a long sidebar. The press then looks like one that did nothing,
// which is exactly how it was reported. Picking the name is not enough to guard
// this: an input can be found and read while never once on screen.
it("puts the rename card where it can be seen, not at the document's end", async () => {
  draw();
  fireEvent.contextMenu(screen.getAllByRole("button", { name: /项目操作/ })[1]);
  await userEvent.click(screen.getByRole("menuitem", { name: "重命名项目" }));
  const card = (await screen.findByRole("dialog", { name: "重命名项目" })) as HTMLElement;
  expect(card.style.left, "the card was left at the document's own position").toBeTruthy();
  expect(card.style.top, "the card was left at the document's own position").toBeTruthy();
});

// The sidebar previews a handful of a folder's conversations; archiving the
// folder is about all of them. A preview that doubled as the action's reach
// left older conversations behind while the row claimed the project was done.
// The press therefore names the project, not the rows: the kernel reads the
// folder's own listing, so conversations past this window's page go too.
it("archives the whole project through the kernel, not the previewed rows", async () => {
  const rows: TreeSession[] = Array.from({ length: 8 }, (_, i) => ({
    path: `/a/${i}.jsonl`, name: String(i), title: `t${i}`,
  }));
  const { row, archiveWorkspace, onArchive, reload } = draw({ total: 8 }, { a: rows }, { previewLimit: 5 });
  fireEvent.contextMenu(row("a"));
  await userEvent.click(screen.getByRole("menuitem", { name: "归档项目对话" }));
  await waitFor(() => expect(archiveWorkspace).toHaveBeenCalledExactlyOnceWith("/a", true));
  // Rows the window happened to hold are not archived one by one.
  expect(onArchive).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalled();
});

// A conversation a pane is running is not closed behind the person's back, and
// archiving has nothing to do while every row is either running or archived:
// the row must not offer an action that would do nothing.
it("does not offer archiving where nothing can be archived", () => {
  const tree = [{
    root: "/a", name: "a", remembered: true,
    sessions: [
      { path: "/a/running.jsonl", name: "running", runtimeId: "r1" },
      { path: "/a/done.jsonl", name: "done", archived: true },
    ],
  }];
  const setWorkspacePinned = vi.fn().mockResolvedValue(undefined);
  render(<Workspaces hub={{ setWorkspacePinned, openWithTargets: async () => [] } as never} tree={tree} treeRead
    runtimes={[{ id: "r1" }] as never} active="" folded={new Set()} onFold={() => {}} reload={vi.fn().mockResolvedValue(undefined)}
    onOpen={async () => {}} onFocus={() => {}} onClose={async () => {}}
    liveIds={(ids) => ids} runs={{ r1: { run: "running", live: true } }} onRename={() => {}}
    onArchive={vi.fn().mockResolvedValue(undefined)} onError={() => {}}
    adder={{ add: () => {}, close: () => {}, at: null } as never} />);
  fireEvent.contextMenu(screen.getByText("a", { selector: ".wsname" }).closest<HTMLElement>('[role="treeitem"]')!);
  expect((screen.getByRole("menuitem", { name: "归档项目对话" }) as HTMLButtonElement).disabled).toBe(true);
});

// The report this all started from: a folder whose conversations were all
// archived stayed in the sidebar, because the active list kept every project
// regardless of what was inside it. A project has no archive state of its own —
// it reads as archived exactly when everything in it is — so the active view
// must drop it, and the archived view is the only place it belongs.
it("drops a project from the active list once every conversation is archived", () => {
  const { row } = draw({}, {
    a: [{ path: "/a/old.jsonl", name: "old", title: "旧的", archived: true }],
    b: [{ path: "/b/new.jsonl", name: "new", title: "新的" }],
  });
  // b still holds an active conversation, so the list itself is drawn.
  expect(row("b")).toBeTruthy();
  expect(screen.queryByText("a", { selector: ".wsname" })).toBeNull();
});

// The other half of the same rule: what left the active list is still findable,
// under Archived. Hiding it in both views would lose the folder entirely.
it("keeps that project in the archived list", () => {
  draw({}, {
    a: [{ path: "/a/old.jsonl", name: "old", title: "旧的", archived: true }],
    b: [{ path: "/b/new.jsonl", name: "new", title: "新的" }],
  }, { scope: "archived" });
  expect(screen.getByText("a", { selector: ".wsname" })).toBeTruthy();
  expect(screen.queryByText("b", { selector: ".wsname" })).toBeNull();
});

// A folder that has just been added holds nothing, and hiding it would take
// away the only place to start a conversation in it.
it("keeps a project that holds no conversation at all", () => {
  const { row } = draw();
  expect(row("a")).toBeTruthy();
  expect(row("b")).toBeTruthy();
});

it("archives an idle open conversation through the kernel", async () => {
  const { row, archiveWorkspace } = draw({}, { a: [{ path: "/a/idle.jsonl", name: "idle", runtimeId: "r1" }] });
  fireEvent.contextMenu(row("a"));
  await userEvent.click(screen.getByRole("menuitem", { name: "归档项目对话" }));
  await waitFor(() => expect(archiveWorkspace).toHaveBeenCalledExactlyOnceWith("/a", true));
});

// A project reads as archived when everything in it is, so the same item turns
// around: in the archived view it restores the folder instead. Without this the
// only way back was to switch views and restore conversations one at a time.
it("offers restoring a project whose conversations are all archived", async () => {
  const done = [{ path: "/a/old.jsonl", name: "old", archived: true }];
  // Archived view: a folder whose conversations are all archived has left the
  // active list, which is what makes this project read as archived at all.
  const { row, archiveWorkspace } = draw({ total: 1, archived: 1 }, { a: done }, { scope: "archived" });
  fireEvent.contextMenu(row("a"));
  await userEvent.click(screen.getByRole("menuitem", { name: "取消归档项目对话" }));
  await waitFor(() => expect(archiveWorkspace).toHaveBeenCalledExactlyOnceWith("/a", false));
});
