// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { Sidebar } from "./Sidebar";
import { MockHub } from "../port/mock_hub";
import { NO_PAGING } from "./treewindow";

// Fold state used to live in localStorage (rx-sidebar-folds), so a launch
// inherited whatever the last one had collapsed. da805c2 replaced that with the
// resting state the owner asked for: every project closed on a cold launch, and
// an opened project remembered only for as long as the sidebar that opened it.
// These guards describe that resting state and the two ways out of it; the
// storage key and its hook are gone, so nothing here mocks storage.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function draw(remote = false) {
  const noop = vi.fn();
  return render(<Sidebar hub={new MockHub()} collapsed={false} navShown treeRead
    tree={[
      { root: "/work/alpha", name: "alpha", remembered: true,
        sessions: [{ path: "/work/alpha/a.jsonl", name: "a", title: "first" }] },
      // A second project, so "every project" and "all of them" can be told
      // apart from "the only one there was".
      { root: "/work/beta", name: "beta", remembered: true,
        sessions: [{ path: "/work/beta/b.jsonl", name: "b", title: "second" }] },
    ]}
    runtimes={[]} runs={{}} active="" activeWorkspace={undefined} liveIds={() => []}
    pinned={new Set()} onPin={noop}
    remotes={remote ? [{ name: "server", target: "server", status: "connected", workspace: "/work/alpha" }] : null}
    remoteTrees={remote ? { server: [{ root: "/work/alpha", name: "remote-alpha", remembered: true,
      sessions: [{ path: "/work/alpha/remote.jsonl", name: "remote", title: "remote session" }] }] } : {}}
    reloadRemotes={async () => {}} reloadRemoteTrees={async () => {}} readRemoteTree={async () => {}}
    reloadTree={async () => {}} paging={NO_PAGING} adder={{ busy: false, add: noop, addPath: noop } as never}
    onOpen={async () => {}} onOpenRemote={async () => {}} onFocusPane={noop} onClosePanes={async () => {}}
    onPause={noop} onArchive={async () => {}} onRename={noop} onCollapse={noop}
    wallet="" onSettings={noop} onFiles={noop} onView={noop}
    onFeedback={noop} feedbackUnread={0} onFind={noop} onError={noop} />);
}

const project = () => screen.getByRole("treeitem", { name: /alpha/ });
const beta = () => screen.getByRole("treeitem", { name: /beta/ });
const rows = () => document.querySelectorAll(".sessrow");
// Rows under one project, so "both projects are open" cannot be satisfied by
// one project holding two conversations.
const rowsUnder = (name: RegExp) =>
  screen.getByRole("treeitem", { name }).closest(".wsnode")!.querySelectorAll(".sessrow").length;
// The heading control is picked by the action it declares, not by the sentence
// it shows: "expand all" and "collapse all" are the same button. Saying why it
// could not be pressed is worth the three lines: `userEvent.click(null)` is a
// silent no-op, and "expected 'true' to be 'false'" sends the reader looking for
// a folding bug instead of a missing control.
const foldAll = () => {
  const control = document.querySelector<HTMLButtonElement>('[data-action="workspace.fold-all"]');
  if (!control) throw new Error("the fold control is not drawn");
  if (control.disabled) throw new Error("the fold control is not usable");
  return control;
};

it("rests with every project folded, so no session row is drawn", () => {
  draw();
  expect(project().getAttribute("aria-expanded")).toBe("false");
  expect(beta().getAttribute("aria-expanded")).toBe("false");
  expect(rows().length).toBe(0);
});

it("opens one project, draws its rows, and folds it back", async () => {
  draw();
  await userEvent.click(project());
  expect(project().getAttribute("aria-expanded")).toBe("true");
  expect(rows().length).toBe(1);
  // The other project stays shut: opening one is not opening all of them.
  expect(beta().getAttribute("aria-expanded")).toBe("false");
  expect(rowsUnder(/^beta/)).toBe(0);
  await userEvent.click(project());
  expect(project().getAttribute("aria-expanded")).toBe("false");
  expect(rows().length).toBe(0);
});

it("opens and folds every project from the heading control", async () => {
  draw();
  await userEvent.click(foldAll());
  expect(project().getAttribute("aria-expanded")).toBe("true");
  expect(beta().getAttribute("aria-expanded")).toBe("true");
  // Per project, not in total: one project drawing two rows would pass a bare
  // count while the other stayed shut.
  expect(rowsUnder(/^alpha/)).toBe(1);
  expect(rowsUnder(/^beta/)).toBe(1);
  await userEvent.click(foldAll());
  expect(project().getAttribute("aria-expanded")).toBe("false");
  expect(beta().getAttribute("aria-expanded")).toBe("false");
  expect(rows().length).toBe(0);
});

// The control offers only "all" and "none", so a partly open list is closed by
// the first press. Reading that press as "open the rest" would leave one
// project open under a heading that says everything is shut.
it("closes a partly open list on the first press", async () => {
  draw();
  await userEvent.click(project());
  expect(rows().length).toBe(1);
  await userEvent.click(foldAll());
  expect(project().getAttribute("aria-expanded")).toBe("false");
  expect(beta().getAttribute("aria-expanded")).toBe("false");
  expect(rows().length).toBe(0);
});

// The one thing that did not change: what a fold means is which project it
// names. A remote project and a local one that happen to share a path are two
// projects, so folding one leaves the other as it was.
it("keeps a remote project's fold separate from the same local path", async () => {
  draw(true);
  const remote = () => screen.getByRole("treeitem", { name: /remote-alpha/ });
  const local = () => screen.getByRole("treeitem", { name: /^alpha/ });
  expect(remote().getAttribute("aria-expanded")).toBe("false");
  expect(local().getAttribute("aria-expanded")).toBe("false");

  // Open the local namesake first, so a fold key shared by path alone would
  // show up as the remote press moving it.
  await userEvent.click(local());
  expect(local().getAttribute("aria-expanded")).toBe("true");

  await userEvent.click(remote());
  expect(remote().getAttribute("aria-expanded")).toBe("true");
  expect(local().getAttribute("aria-expanded")).toBe("true");

  // And the other direction: folding the remote project again leaves the local
  // one exactly where it was.
  await userEvent.click(remote());
  expect(remote().getAttribute("aria-expanded")).toBe("false");
  expect(local().getAttribute("aria-expanded")).toBe("true");
});

// A fold is this session's alone: drawing the sidebar again is a cold start, and
// nothing the last one opened carries over.
it("forgets the projects it opened when the sidebar is drawn again", async () => {
  let view = draw();
  await userEvent.click(project());
  expect(project().getAttribute("aria-expanded")).toBe("true");

  view.unmount();
  view = draw();
  expect(project().getAttribute("aria-expanded")).toBe("false");
  expect(rows().length).toBe(0);
});

// The other half of "no memory across launches": the old hook wrote the folded
// set to storage as well as reading it. A build that stopped reading but kept
// writing would pass every guard above, so say the write is gone too.
it("writes no fold to storage", async () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  draw();
  await userEvent.click(project());
  expect(project().getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(foldAll());
  expect(project().getAttribute("aria-expanded")).toBe("false");
  expect(setItem, "a fold was written to storage").not.toHaveBeenCalled();
});
