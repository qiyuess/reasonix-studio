// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { Workspaces } from "./Workspaces";
import { RailSearch } from "./railsearch";
import type { TreeSession, TreeWorkspace } from "../port/hub";

afterEach(cleanup);

const rows = (sessions: TreeSession[]): TreeSession[] => sessions;
const A: TreeSession = { path: "/w/s/a.jsonl", name: "a", title: "alpha plan" };
const B: TreeSession = { path: "/w/s/b.jsonl", name: "b", title: "beta review" };
const C: TreeSession = { path: "/w/s/c.jsonl", name: "c", title: "gamma notes" };

function draw(sessions: TreeSession[] = [A, B, C], fail?: Error) {
  const tree: TreeWorkspace[] = [{ root: "/w", name: "w", sessions: rows(sessions) }];
  const placeSession = vi.fn(async () => { if (fail) throw fail; });
  const reload = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  render(<RailSearch><Workspaces
    hub={{ placeSession } as never} tree={tree} treeRead runtimes={[]} active="" folded={new Set()} onFold={() => {}} reload={reload}
    onOpen={vi.fn().mockResolvedValue(undefined)} onFocus={() => {}} onClose={vi.fn().mockResolvedValue(undefined)}
    liveIds={() => []} runs={{}} scope="all" onArchive={vi.fn()} onRename={() => {}} onError={onError}
    adder={{ add: () => {}, close: () => {}, at: null } as never}
  /></RailSearch>);
  return { placeSession, reload, onError };
}

const row = (title: string) => screen.getByRole("treeitem", { name: new RegExp(title) });
const openMenu = (title: string) => {
  fireEvent.contextMenu(row(title));
};

it("moves one slot from the row's own keyboard steps", async () => {
  const { placeSession, reload } = draw();
  row("beta review").focus();
  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  // One step up is one place: land before the row above, not a walk of swaps.
  expect(placeSession).toHaveBeenCalledExactlyOnceWith(B.path, A.path);
});

it("moves through the kernel once, then asks the tree again rather than patching it", async () => {
  const { placeSession, reload } = draw();
  row("beta review").focus();
  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(placeSession).toHaveBeenCalledExactlyOnceWith(B.path, A.path);
  expect(reload).toHaveBeenCalledTimes(1);
});

it("keeps keyboard menus and move shortcuts available on the same row", async () => {
  const { placeSession } = draw();
  row("beta review").focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  expect(screen.getByRole("menuitem", { name: "置顶会话" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "归档会话" })).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  row("beta review").focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  // B's one step down passes the foot row: it lands at the end of the run.
  await waitFor(() => expect(placeSession).toHaveBeenCalledExactlyOnceWith(B.path, ""));
  expect(document.activeElement).toBe(row("beta review"));
});

it("moves with Alt+Arrow on the focused row, and ignores a step that has nowhere to go", async () => {
  const { placeSession } = draw();
  fireEvent.keyDown(row("beta review"), { key: "ArrowDown", altKey: true });
  await waitFor(() => expect(placeSession).toHaveBeenCalledExactlyOnceWith(B.path, ""));
  fireEvent.keyDown(row("alpha plan"), { key: "ArrowUp", altKey: true }); // already at the head
  fireEvent.keyDown(row("gamma notes"), { key: "ArrowDown", altKey: true }); // already at the foot
  fireEvent.keyDown(row("beta review"), { key: "ArrowDown" }); // no Alt: not a move
  expect(placeSession).toHaveBeenCalledTimes(1);
});

// Reordering is the row's drag and Alt+Arrow. The menu used to carry the same
// two steps, which made a menu of nine actions advertise a move the drag already
// did better; it no longer does.
it("leaves the one-slot move out of the menu, which carries actions a drag cannot", async () => {
  draw();
  for (const title of ["gamma notes", "alpha plan"]) {
    openMenu(title);
    expect(screen.queryByRole("menuitem", { name: "上移" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "下移" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "置顶会话" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
  }
});

it("says so when the kernel refuses a move and leaves the list as it was", async () => {
  const { onError, reload } = draw([A, B, C], new Error("no room"));
  row("beta review").focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  expect(reload).not.toHaveBeenCalled();
});

it("has no order to move within while a search narrows the list", async () => {
  const { placeSession } = draw();
  await userEvent.type(screen.getByRole("searchbox"), "a");
  row("beta review").focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  await Promise.resolve();
  expect(placeSession).not.toHaveBeenCalled();
});
