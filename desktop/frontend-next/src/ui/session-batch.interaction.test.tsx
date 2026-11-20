// @vitest-environment jsdom
import "./testkit";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Workspaces } from "./Workspaces";
import { RailSearch } from "./railsearch";
import { draftKey, readDraft, writeDraft } from "./drafts";
import { boot, STORAGE } from "../i18n";
import { SessionBatch } from "./SessionBatch";
import type { TreeSession, TreeWorkspace } from "../port/hub";
import rowsCss from "../design/rows.css?raw";

afterEach(() => { cleanup(); localStorage.setItem(STORAGE, "zh"); boot(); localStorage.clear(); vi.restoreAllMocks(); });

const sessions: TreeSession[] = [
  { path: "/sessions/a.jsonl", name: "a", title: "Alpha", runtimeId: "r1" },
  { path: "/sessions/b.jsonl", name: "b", title: "Beta" },
  { path: "/sessions/c.jsonl", name: "c", title: "Gamma", archived: true },
];

function draw(rows = sessions, scope: "all" | "archived" = "all", folded = new Set<string>(),
  tree: TreeWorkspace[] = [{ root: "/w", name: "Project", remembered: true, sessions: rows }],
  onArchiveQuiet?: (path: string, archived: boolean, runtimeId?: string) => Promise<void>) {
  const hub = { removeSession: vi.fn().mockResolvedValue(undefined), removeWorkspace: vi.fn().mockResolvedValue(undefined),
    moveSessionTo: vi.fn().mockResolvedValue({ path: "", originalRemoved: true }) };
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn().mockResolvedValue(undefined);
  const onOpen = vi.fn().mockResolvedValue(undefined);
  const onFocus = vi.fn();
  const onError = vi.fn();
  const add = vi.fn();
  const reload = vi.fn().mockResolvedValue(undefined);
  let live: string[] = [];
  const props = { hub: hub as never, tree, treeRead: true, runtimes: [{ id: "r1" }] as never, active: "r1", folded, onFold: vi.fn(),
    // The window folds a whole group from its label; the harness keeps that
    // set the way the rows' own chevrons read it.
    onFoldGroup: (roots: string[], shut: boolean) => {
      const next = new Set(props.folded);
      for (const root of roots) { if (shut) next.add(root); else next.delete(root); }
      props.folded = next;
      view.rerender(<RailSearch><Workspaces {...props} /></RailSearch>);
    },
    reload,
    onOpen, onFocus, onClose, liveIds: (ids: string[]) => ids.filter((id) => live.includes(id)), runs: {},
    scope, onArchive, onArchiveQuiet, onRename: vi.fn(), onError, adder: { add, close: vi.fn(), at: null } as never };
  const view = render(<RailSearch><Workspaces {...props} /></RailSearch>);
  return { hub, onArchive, onArchiveQuiet, onClose, onOpen, onFocus, onError, reload, add, removeWorkspace: hub.removeWorkspace, moveSessionTo: hub.moveSessionTo,
    live: (ids: string[]) => { live = ids; view.rerender(<RailSearch><Workspaces {...props}
      runs={Object.fromEntries(ids.map((id) => [id, { run: "running", live: true }]))} /></RailSearch>); },
    update: (tree: TreeWorkspace[]) => { props.tree = tree; view.rerender(<RailSearch><Workspaces {...props} /></RailSearch>); },
    fold: (roots: Set<string>) => { props.folded = roots; view.rerender(<RailSearch><Workspaces {...props} /></RailSearch>); } };
}

const projectRow = () =>
  screen.getByText("Project", { selector: ".wsname" }).closest<HTMLElement>('[role="treeitem"]')!;

// Picking starts from a row's right-click menu now — the header button is gone
// on purpose — and the menu seeds the mode with the row that was clicked.
async function startSelection(row = document.querySelector<HTMLElement>(".sessrow")!) {
  fireEvent.contextMenu(row);
  await userEvent.click(screen.getByRole("menuitem", { name: /批量管理/ }));
}

async function selectAll() {
  await startSelection();
  // A lone displayed row arrives all-chosen from its menu, and the toggle only
  // exists while something on screen is still unpicked.
  const toggle = screen.queryByRole("button", { name: "全选当前显示的会话" });
  if (toggle) await userEvent.click(toggle);
}

it("keeps the batch entry in a conversation's menu without occupying an idle toolbar", async () => {
  draw();
  expect(document.querySelector(".session-batch-entry, .session-batch")).toBeNull();
  // The header button is gone on purpose: picking starts from a conversation's
  // own right-click menu, so the idle toolbar keeps only the view, the filter
  // and the way into a new project.
  expect(screen.queryByRole("button", { name: "选择本机会话" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "选择本机会话" })).toBeNull();
  // A project's menu does not offer it: picking is a conversation's action.
  fireEvent.contextMenu(projectRow());
  expect(screen.queryByRole("menuitem", { name: /批量管理/ })).toBeNull();
  await userEvent.keyboard("{Escape}");
  // The conversation's menu carries it, seeded with the clicked row.
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: /Beta/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: /批量管理/ }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByText("已选 1 个会话")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "删除所选会话" }));
});

it("starts from a conversation and the fold prunes what it seeded", async () => {
  const pane = draw(sessions, "all", new Set());
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: /Alpha/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: /批量管理/ }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByText("已选 1 个会话")).toBeTruthy();
  // A fold prunes what the mode seeded: a hidden row cannot stay picked.
  pane.fold(new Set(["/w"]));
  expect(screen.getByText("已选 0 个会话")).toBeTruthy();
  expect((screen.getByRole("button", { name: "删除所选会话" }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps opening projects and the list menu outside the project tree", async () => {
  const pane = draw([], "all", new Set(), []);
  // The empty tree's own button is the way in: adding a project never grows a
  // machine row inside the tree.
  await userEvent.click(screen.getByRole("button", { name: "打开第一个项目" }));
  expect(pane.add).toHaveBeenCalledOnce();
  expect(screen.queryByRole("treeitem", { name: /这台机器/ })).toBeNull();
  pane.update([{ root: "/w", name: "Project", remembered: true, sessions }]);
  await startSelection();
  expect(screen.getByText("Alpha")).toBeTruthy();
});

it("selects rows with clicks and the keyboard without opening or focusing a pane", async () => {
  const pane = draw();
  await startSelection(); // Alpha arrives chosen from its menu
  const alpha = screen.getByRole("treeitem", { name: /Alpha/ });
  const beta = screen.getByRole("treeitem", { name: /Beta/ });
  await userEvent.click(beta);
  expect(alpha.getAttribute("aria-selected")).toBe("true");
  expect(beta.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("已选 2 个会话")).toBeTruthy();
  beta.focus();
  await userEvent.keyboard(" ");
  expect(beta.getAttribute("aria-selected")).toBe("false");
  expect(screen.getByText("已选 1 个会话")).toBeTruthy();
  await userEvent.keyboard(" ");
  expect(beta.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("已选 2 个会话")).toBeTruthy();
  await userEvent.dblClick(screen.getByText("Alpha"));
  expect(screen.queryByRole("textbox", { name: "重命名该会话" })).toBeNull();
  expect(pane.onOpen).not.toHaveBeenCalled();
  expect(pane.onFocus).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "完成选择" }));
  // The tree's own group label takes the keyboard back: the toolbar holds no
  // entry for picking any more.
  expect(document.activeElement).toBe(document.querySelector<HTMLElement>('[data-action="workspace.fold-all"][data-value="projects"]'));
  await userEvent.click(beta);
  expect(pane.onOpen).toHaveBeenCalledWith({ root: "/w", sessionPath: "/sessions/b.jsonl" });
});

it("archives selected sessions through the same owner as an individual row", async () => {
  const pane = draw();
  await selectAll();
  await userEvent.click(screen.getByRole("button", { name: "归档所选会话" }));
  await waitFor(() => expect(pane.onArchive).toHaveBeenCalledTimes(2));
  expect(pane.onArchive).toHaveBeenNthCalledWith(1, "/sessions/a.jsonl", true, "r1");
  expect(pane.onArchive).toHaveBeenNthCalledWith(2, "/sessions/b.jsonl", true, undefined);
  expect(screen.getByText("已选 0 个会话")).toBeTruthy();
});

it("archives a batch with one tree read", async () => {
  const quiet = vi.fn().mockResolvedValue(undefined);
  const pane = draw(sessions, "all", new Set(), undefined, quiet);
  await selectAll();
  await userEvent.click(screen.getByRole("button", { name: "归档所选会话" }));
  await waitFor(() => expect(quiet).toHaveBeenCalledTimes(2));
  expect(quiet).toHaveBeenNthCalledWith(1, "/sessions/a.jsonl", true, "r1");
  expect(quiet).toHaveBeenNthCalledWith(2, "/sessions/b.jsonl", true, undefined);
  await waitFor(() => expect(pane.reload).toHaveBeenCalledTimes(1));
  expect(screen.getByText("已选 0 个会话")).toBeTruthy();
});

it("restores only the selected archived rows", async () => {
  const pane = draw(sessions, "archived");
  await selectAll();
  await userEvent.click(screen.getByRole("button", { name: "取消所选会话归档" }));
  await waitFor(() => expect(pane.onArchive).toHaveBeenCalledWith("/sessions/c.jsonl", false, undefined));
  expect(pane.onArchive).toHaveBeenCalledTimes(1);
});

it("deletes selected project conversations in one step, since the folder and its files stay", async () => {
  const pane = draw();
  await selectAll();
  await userEvent.click(screen.getByRole("button", { name: "删除所选会话" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await waitFor(() => expect(pane.hub.removeSession).toHaveBeenCalledTimes(2));
  expect(pane.onClose).toHaveBeenCalledWith(["r1"]);
  expect(pane.hub.removeSession.mock.calls.map(([path]) => path).sort()).toEqual(["/sessions/a.jsonl", "/sessions/b.jsonl"]);
  expect(pane.reload).toHaveBeenCalledTimes(1);
});

it("asks before deleting a task conversation, whose artifacts go with it", async () => {
  const tree: TreeWorkspace[] = [
    { root: "/w", name: "Project", remembered: true, sessions: [{ path: "/sessions/a.jsonl", name: "a", title: "Alpha", workspaceRoot: "/w" }] },
    { root: "/auto", name: "auto", auto: true, sessions: [{ path: "/sessions/t.jsonl", name: "t", title: "Task", workspaceRoot: "/auto" }] },
  ];
  const pane = draw([], "all", new Set(), tree);
  await selectAll();
  await userEvent.click(screen.getByRole("button", { name: "删除所选会话" }));
  const question = screen.getByRole("alertdialog", { name: "删除 2 个会话？" });
  expect(within(question).getByText(/1 个任务对话连同其产物/)).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(pane.hub.removeSession).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "删除所选会话" }));
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "删除" }));
  await waitFor(() => expect(pane.hub.removeSession).toHaveBeenCalledTimes(2));
});

it("keeps failed rows selected while removing successful rows from the batch", async () => {
  const pane = draw();
  const failure = new Error("storage unavailable");
  pane.onArchive.mockRejectedValueOnce(failure);
  await selectAll();
  await userEvent.click(screen.getByRole("button", { name: "归档所选会话" }));
  await waitFor(() => expect(pane.onError).toHaveBeenCalledWith(failure));
  expect(screen.getByText("已选 1 个会话")).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: /Alpha/ }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("treeitem", { name: /Beta/ }).getAttribute("aria-selected")).toBe("false");
});

it("does not stop running sessions, including a turn that starts after selection", async () => {
  const pane = draw();
  await selectAll();
  pane.live(["r1"]);
  expect((screen.getByRole("button", { name: "归档所选会话" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "删除所选会话" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("所选会话正在运行，停止后才能操作")).toBeTruthy();
  expect(pane.onClose).not.toHaveBeenCalled();
  expect(pane.hub.removeSession).not.toHaveBeenCalled();
});

it("rechecks each running state during a batch instead of stopping a newly started turn", async () => {
  const pane = draw([sessions[0]!, { ...sessions[1]!, runtimeId: "r2" }]);
  pane.onArchive.mockImplementationOnce(async () => pane.live(["r2"]));
  await selectAll();
  await userEvent.click(screen.getByRole("button", { name: "归档所选会话" }));
  await waitFor(() => expect(pane.onError).toHaveBeenCalled());
  expect(pane.onArchive).toHaveBeenCalledTimes(1);
  expect(pane.onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("treeitem", { name: /Beta/ }).getAttribute("aria-selected")).toBe("true");
});

it("keeps a session when closing its pane is refused and still deletes the other selected row", async () => {
  const pane = draw();
  const failure = new Error("pane cannot close");
  const kept = draftKey("", "/w", "/sessions/a.jsonl");
  const removed = draftKey("", "/w", "/sessions/b.jsonl");
  const remote = draftKey("other-host", "/w", "/sessions/b.jsonl");
  writeDraft(kept, "keep the refused session");
  writeDraft(removed, "delete with the removed session");
  writeDraft(remote, "keep the remote session");
  pane.onClose.mockRejectedValueOnce(failure);
  await selectAll();
  await userEvent.click(screen.getByRole("button", { name: "删除所选会话" }));
  await waitFor(() => expect(pane.onError).toHaveBeenCalledWith(failure));
  expect(pane.hub.removeSession).toHaveBeenCalledTimes(1);
  expect(pane.hub.removeSession).toHaveBeenCalledWith("/sessions/b.jsonl");
  expect(screen.getByText("已选 1 个会话")).toBeTruthy();
  expect(readDraft(kept)).toBe("keep the refused session");
  expect(readDraft(removed)).toBe("");
  expect(readDraft(remote)).toBe("keep the remote session");
});

it("keeps a pending batch from being submitted twice", async () => {
  const pane = draw();
  let release: () => void = () => {};
  pane.onArchive.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  await selectAll();
  await userEvent.dblClick(screen.getByRole("button", { name: "归档所选会话" }));
  // Rows go together: the first click starts one request per row, and the
  // second click of the double-click finds the batch already pending.
  expect(pane.onArchive).toHaveBeenCalledTimes(2);
  expect((screen.getByRole("button", { name: "完成选择" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => release());
  await waitFor(() => expect(pane.onArchive).toHaveBeenCalledTimes(2));
});

it("selects only displayed rows and clears the selection when the query changes", async () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ path: `/sessions/${i}.jsonl`, name: `${i}`, title: `Task ${i}` }));
  const pane = draw(many);
  await selectAll();
  expect(screen.getByText("已选 35 个会话")).toBeTruthy();
  await userEvent.type(screen.getByRole("searchbox", { name: "搜索会话 / 项目" }), "Task 34");
  expect(screen.getByText("已选 0 个会话")).toBeTruthy();
  expect(pane.onArchive).not.toHaveBeenCalled();
});

it("drops deleted selections when a tree refresh removes their canonical rows", async () => {
  const pane = draw();
  await selectAll();
  pane.update([{ root: "/w", name: "Project", sessions: [sessions[1]!] }]);
  expect(screen.getByText("已选 1 个会话")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "归档所选会话" }));
  await waitFor(() => expect(pane.onArchive).toHaveBeenCalledWith("/sessions/b.jsonl", true, undefined));
  expect(pane.onArchive).toHaveBeenCalledTimes(1);
});

it("removes hidden selections when projects are folded", async () => {
  const pane = draw();
  await selectAll();
  pane.update([
    { root: "/w", name: "Project", remembered: true, sessions },
    { root: "/other", name: "Other", remembered: true, sessions: [{ path: "/sessions/d.jsonl", name: "Delta" }] },
  ]);
  pane.fold(new Set(["/w"]));
  expect(screen.getByText("已选 0 个会话")).toBeTruthy();
  pane.fold(new Set());
  expect(screen.getByText("已选 0 个会话")).toBeTruthy();
  pane.fold(new Set(["/w"]));
  await userEvent.click(screen.getByRole("button", { name: "全选当前显示的会话" }));
  expect(screen.getByText("已选 1 个会话")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "取消当前显示会话的选择" }));
  expect(screen.getByText("已选 0 个会话")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "全选当前显示的会话" }));
  pane.fold(new Set(["/w", "/other"]));
  expect(screen.getByText("已选 0 个会话")).toBeTruthy();
  expect((screen.getByRole("button", { name: "删除所选会话" }) as HTMLButtonElement).disabled).toBe(true);
  expect(pane.onArchive).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "完成选择" }));
  // Every project is folded, so picking keeps no hidden row; the tree's own
  // 项目 label answers the keyboard whether the group is folded or not.
  expect(document.activeElement).toBe(document.querySelector<HTMLElement>('[data-action="workspace.fold-all"][data-value="projects"]'));
});

it("selects every loaded row of a search matching the project name, and only those", async () => {
  draw(Array.from({ length: 35 }, (_, i) => ({ path: `/sessions/${i}.jsonl`, name: `${i}`, title: `Task ${i}` })));
  await userEvent.type(screen.getByRole("searchbox", { name: "搜索会话 / 项目" }), "Project");
  await selectAll();
  expect(screen.getByText("已选 35 个会话")).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: /Task 34/ })).toBeTruthy();
});

it("says 全部选中 and 全部取消 for the rows on screen", async () => {
  draw();
  await startSelection();
  expect(screen.getByText("全部选中")).toBeTruthy();
  expect(screen.queryByText("全选可见")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "全选当前显示的会话" }));
  expect(screen.getByText("全部取消")).toBeTruthy();
  expect(screen.queryByText("取消全选")).toBeNull();
});

it("enters picking from a session's menu with that session already chosen", async () => {
  const pane = draw();
  const alpha = screen.getByRole("treeitem", { name: /Alpha/ });
  fireEvent.contextMenu(alpha);
  await userEvent.click(screen.getByRole("menuitem", { name: /批量管理/ }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByText("已选 1 个会话")).toBeTruthy();
  expect(alpha.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("treeitem", { name: /Beta/ }).getAttribute("aria-selected")).toBe("false");
  expect(pane.onOpen).not.toHaveBeenCalled();
  expect(pane.onFocus).not.toHaveBeenCalled();
});

// Bulk-unfollowing a project left the bar: it lives in each project's own
// context menu (从列表移除), covered by workspace-context-menu tests. The
// bar's delete speaks per kind — task conversations take their artifacts,
// project conversations leave the folder whole.

function drawBatch(overrides: {
  selected?: TreeSession[];
  displayed?: TreeSession[];
  projects?: { root: string; name: string }[];
  hub?: Record<string, unknown>;
  liveIds?: (ids: string[]) => string[];
  reload?: () => Promise<void>;
  onError?: (e: unknown) => void;
  onSelect?: (next: Set<string> | null) => void;
} = {}) {
  const selected = overrides.selected ?? [{ path: "/s/a.jsonl", name: "a" }, { path: "/s/b.jsonl", name: "b" }];
  const displayed = overrides.displayed ?? selected;
  const hub = overrides.hub ?? { moveSessionTo: vi.fn().mockResolvedValue({ path: "", originalRemoved: true }) };
  const reload = overrides.reload ?? vi.fn().mockResolvedValue(undefined);
  const onError = overrides.onError ?? vi.fn();
  const onSelect = overrides.onSelect ?? vi.fn();
  const liveIds = overrides.liveIds ?? (() => [] as string[]);
  const view = render(<SessionBatch hub={hub as never} selection={new Set(selected.map((s) => s.path))}
    selected={selected} displayed={displayed} onSelect={onSelect} onExit={vi.fn()} onBusy={vi.fn()}
    onClose={vi.fn().mockResolvedValue(undefined)} onArchive={vi.fn().mockResolvedValue(undefined)}
    liveIds={liveIds} reload={reload} onError={onError}
    projects={overrides.projects ?? [{ root: "/p1", name: "One" }, { root: "/p2", name: "Two" }]} />);
  return { view, hub, reload, onError, onSelect };
}

it("paints selected rows with a token-based highlight only while multi-select is on", () => {
  const rules = [...rowsCss.matchAll(/\[aria-multiselectable="true"\]\s+\.sessrow\[aria-selected="true"\]\s*\{([^}]*)\}/g)];
  expect(rules.length).toBeGreaterThan(0);
  expect(rules[0]![1]).toMatch(/background:\s*var\(--accent-wash\)/);
});

it("marks the chosen rows selected for the highlight to catch while picking", async () => {
  draw();
  await startSelection();
  expect(screen.getByRole("tree").getAttribute("aria-multiselectable")).toBe("true");
  expect(screen.getByRole("treeitem", { name: /Alpha/ }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("treeitem", { name: /Beta/ }).getAttribute("aria-selected")).toBe("false");
});

it("moves every eligible selected session to the picked project in parallel with one reload", async () => {
  let inFlight = 0;
  let peak = 0;
  const moveSessionTo = vi.fn().mockImplementation(async () => {
    peak = Math.max(peak, ++inFlight);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    inFlight--;
    return { path: "", originalRemoved: true };
  });
  const { hub, reload } = drawBatch({ hub: { moveSessionTo } });
  await userEvent.click(screen.getByRole("button", { name: "移动所选会话到项目" }));
  const menu = screen.getByRole("menu", { name: "选择目标项目" });
  await userEvent.click(within(menu).getByRole("menuitem", { name: /One/ }));
  expect(moveSessionTo).toHaveBeenCalledTimes(2);
  expect(moveSessionTo).toHaveBeenCalledWith("/s/a.jsonl", "/p1");
  expect(moveSessionTo).toHaveBeenCalledWith("/s/b.jsonl", "/p1");
  expect(peak).toBe(2);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(hub).toBeTruthy();
});

it("skips live and no-pane rows when moving a batch, exactly where the row menu disables it", async () => {
  const selected: TreeSession[] = [
    { path: "/s/plain.jsonl", name: "plain" },
    { path: "/s/live.jsonl", name: "live", runtimeId: "r-live" },
  ];
  const moveSessionTo = vi.fn().mockResolvedValue({ path: "", originalRemoved: true });
  drawBatch({ selected, hub: { moveSessionTo }, liveIds: (ids) => ids.filter((id) => id === "r-live") });
  await userEvent.click(screen.getByRole("button", { name: "移动所选会话到项目" }));
  await userEvent.click(within(screen.getByRole("menu", { name: "选择目标项目" })).getByRole("menuitem", { name: /Two/ }));
  expect(moveSessionTo).toHaveBeenCalledTimes(1);
  expect(moveSessionTo).toHaveBeenCalledWith("/s/plain.jsonl", "/p2");
});

it("keeps a refused move selected and reports the failure without reloading a second time", async () => {
  const failure = new Error("no write lease");
  const moveSessionTo = vi.fn().mockResolvedValueOnce({ path: "", originalRemoved: true }).mockRejectedValueOnce(failure);
  const onError = vi.fn();
  const onSelect = vi.fn();
  const reload = vi.fn().mockResolvedValue(undefined);
  drawBatch({ hub: { moveSessionTo }, onError, onSelect, reload });
  await userEvent.click(screen.getByRole("button", { name: "移动所选会话到项目" }));
  await userEvent.click(within(screen.getByRole("menu", { name: "选择目标项目" })).getByRole("menuitem", { name: /One/ }));
  await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  expect(onSelect).toHaveBeenCalledWith(new Set(["/s/b.jsonl"]));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});

it("holds the batch delete as one fixed status row instead of growing the bar while it works", async () => {
  draw();
  await selectAll();
  const bar = document.querySelector<HTMLElement>(".session-batch")!;
  expect(bar.querySelector(".session-batch-head .session-batch-status")).toBeTruthy();
  expect(bar.querySelector(".session-batch-actions")?.children).toHaveLength(3);
  expect(bar.querySelectorAll("p")).toHaveLength(0);
  expect(within(bar).getByRole("status").textContent).toContain("已选 2 个会话");
});

it("deletes project conversations in parallel: a later row starts before an earlier close resolves", async () => {
  const pane = draw();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  pane.onClose.mockImplementation(() => gate);
  await selectAll();
  await userEvent.click(screen.getByRole("button", { name: "删除所选会话" }));
  await waitFor(() => expect(pane.hub.removeSession).toHaveBeenCalledWith("/sessions/b.jsonl"));
  expect(pane.onClose).toHaveBeenCalledWith(["r1"]);
  expect(pane.reload).not.toHaveBeenCalled();
  await act(async () => release());
  await waitFor(() => expect(pane.reload).toHaveBeenCalledTimes(1));
  expect(pane.hub.removeSession).toHaveBeenCalledTimes(2);
});
