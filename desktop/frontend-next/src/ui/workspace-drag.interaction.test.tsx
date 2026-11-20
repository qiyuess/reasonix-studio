// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./testkit";
import { Workspaces } from "./Workspaces";
import type { TreeWorkspace } from "../port/hub";

afterEach(cleanup);

function draw(over: { reject?: boolean; remembered?: boolean[] } = {}) {
  const names = ["a", "b", "c", "d"];
  const tree: TreeWorkspace[] = names.map((name, i) => ({ root: "/" + name, name, remembered: over.remembered?.[i] ?? true, sessions: [] }));
  const placeWorkspace = over.reject ? vi.fn().mockRejectedValue(new Error("write failed")) : vi.fn().mockResolvedValue(undefined);
  const reload = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  render(<Workspaces hub={{ placeWorkspace } as never} tree={tree} treeRead runtimes={[]} active=""
    folded={new Set()} onFold={() => {}} reload={reload} onOpen={async () => {}} onFocus={() => {}}
    onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}} onError={onError}
    adder={{ add: () => {}, close: () => {}, at: null } as never} />);
  lay();
  return { placeWorkspace, reload, onError };
}

const row = (name: string) => screen.getByText(name, { selector: ".wsrow *" }).closest(".wsrow") as HTMLElement;
const node = (name: string) => row(name).closest<HTMLElement>(".wsnode")!;

// jsdom lays nothing out, so the run's own boxes are given: one row of 40px
// stacked on the next, the way the sidebar draws them. The container handler
// reads these to name the slot the pointer sits in.
function lay() {
  const tops: Record<string, number> = { a: 100, b: 140, c: 180, d: 220 };
  for (const [name, top] of Object.entries(tops)) {
    const rect = () => ({ top, bottom: top + 40, height: 40, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) } as DOMRect);
    node(name).getBoundingClientRect = rect;
    row(name).getBoundingClientRect = rect;
  }
}

function transfer() {
  const data = new Map<string, string>();
  return {
    types: [] as string[],
    effectAllowed: "", dropEffect: "",
    setData(kind: string, value: string) { data.set(kind, value); this.types = [...data.keys()]; },
    getData: (kind: string) => data.get(kind) ?? "",
  };
}

// The drop events are received by the tree container, not the row: the row the
// pointer is over only carries the pointer's height, so the event carries a
// clientY and bubbles to the handler that reads every row's box.
function send(type: "dragOver" | "drop", el: HTMLElement, dt: object, y: number) {
  const ev = createEvent[type](el, { dataTransfer: dt });
  Object.defineProperty(ev, "clientY", { value: y });
  fireEvent(el, ev);
  return ev;
}

async function drag(from: string, to: string, y: number) {
  const dt = transfer();
  fireEvent.dragStart(row(from), { dataTransfer: dt });
  const ev = send("dragOver", row(to), dt, y);
  send("drop", row(to), dt, y);
  fireEvent.dragEnd(row(from), { dataTransfer: dt });
  return ev;
}

it("drops a project into the slot the pointer named, and the kernel is told the place", async () => {
  const { placeWorkspace, reload } = draw();
  // c released over a's upper half: the slot above a.
  const ev = await drag("c", "a", 105);
  expect(ev.defaultPrevented).toBe(true);
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(placeWorkspace).toHaveBeenCalledExactlyOnceWith("/c", "/a");
});

it("the pointer's half of a row names the slot around it: above, below, or the run's end", async () => {
  const { placeWorkspace } = draw();
  await drag("a", "b", 145); // b's upper half: the slot between a and b is a's own — nothing moves
  await drag("a", "b", 165); // b's lower half: a lands before c
  await waitFor(() => expect(placeWorkspace).toHaveBeenLastCalledWith("/a", "/c"));
  await drag("a", "d", 245); // below d's middle: the end of the run
  await waitFor(() => expect(placeWorkspace).toHaveBeenLastCalledWith("/a", ""));
  expect(placeWorkspace).toHaveBeenCalledTimes(2);
});

it("a row dropped into the slot it already fills asks nothing of the kernel", async () => {
  const { placeWorkspace } = draw();
  await drag("b", "b", 145); // its own upper half
  await drag("b", "c", 185); // the lower row's upper half is the gap b already sits in
  expect(placeWorkspace).not.toHaveBeenCalled();
});

it("the line rides the slot the pointer named, and clears when the slot is its own", async () => {
  draw();
  const dt = transfer();
  fireEvent.dragStart(row("b"), { dataTransfer: dt });
  send("dragOver", row("a"), dt, 105); // a's upper half: the slot above a, where b will land
  expect(node("a").getAttribute("data-drop")).toBe("before");
  send("dragOver", row("c"), dt, 185); // c's upper half: the slot b already fills — no line anywhere
  expect(node("a").hasAttribute("data-drop")).toBe(false);
  expect(node("c").hasAttribute("data-drop")).toBe(false);
  send("dragOver", row("c"), dt, 205); // c's lower half: the slot below c
  expect(node("d").getAttribute("data-drop")).toBe("before");
  fireEvent.dragEnd(row("b"), { dataTransfer: dt });
  expect(node("d").hasAttribute("data-drop")).toBe(false);
});

it("the pointer's half decides, whichever way the row is being carried", async () => {
  // A row carried upwards still names the slot under the pointer: c over a's
  // lower half lands between a and b, not above a.
  draw();
  const dt = transfer();
  fireEvent.dragStart(row("c"), { dataTransfer: dt });
  send("dragOver", row("a"), dt, 105);
  expect(node("a").getAttribute("data-drop")).toBe("before");
  send("dragOver", row("a"), dt, 125);
  expect(node("b").getAttribute("data-drop")).toBe("before");
  expect(node("a").hasAttribute("data-drop")).toBe(false);
  fireEvent.dragEnd(row("c"), { dataTransfer: dt });
  expect(node("b").hasAttribute("data-drop")).toBe(false);
});

it("leaves everything else that is dragged over a project row alone", () => {
  const { placeWorkspace } = draw();
  const files = { types: ["Files"], getData: () => "" };
  const ev = send("dragOver", row("a"), files, 105);
  expect(ev.defaultPrevented).toBe(false);
  fireEvent.drop(row("a"), { dataTransfer: files });
  expect(placeWorkspace).not.toHaveBeenCalled();
});

it("a folder the launch opened means the end of the remembered order, whichever half is under the pointer", async () => {
  // A folder that only holds older conversations sits after the remembered
  // ones and keeps no slot of its own, so the one place a drop on it can mean
  // is the end of the remembered order — immediately above it.
  const { placeWorkspace } = draw({ remembered: [true, true, true, false] });
  for (const y of [225, 245]) {
    const dt = transfer();
    fireEvent.dragStart(row("a"), { dataTransfer: dt });
    send("dragOver", row("d"), dt, y);
    await waitFor(() => expect(node("d").getAttribute("data-drop")).toBe("before"));
    send("drop", row("d"), dt, y);
    fireEvent.dragEnd(row("a"), { dataTransfer: dt });
    await waitFor(() => expect(placeWorkspace).toHaveBeenLastCalledWith("/a", ""));
  }
});

it("carries a folder the sidebar never stored, and the drop gives it the place it landed on", async () => {
  // Pressing a launch-opened folder used to select its name instead of lifting
  // it: the row was drawn but never draggable. It is a row like any other, and
  // the slot the pointer named is what gets stored.
  const { placeWorkspace } = draw({ remembered: [true, false, true, true] });
  expect(row("b").getAttribute("draggable")).toBe("true");
  await drag("b", "a", 105);
  await waitFor(() => expect(placeWorkspace).toHaveBeenLastCalledWith("/b", "/a"));
  await drag("b", "c", 185);
  await waitFor(() => expect(placeWorkspace).toHaveBeenLastCalledWith("/b", "/c"));
});

it("a drop above a folder with no remembered slot still names a place", async () => {
  // The carried row is clamped into the block it belongs to: the pointer above
  // the launch-opened folder names that folder's own head — before the first
  // remembered row it can land among.
  const { placeWorkspace } = draw({ remembered: [true, false, true, true] });
  const dt = transfer();
  fireEvent.dragStart(row("d"), { dataTransfer: dt });
  expect(send("dragOver", row("b"), dt, 145).defaultPrevented).toBe(true);
  send("drop", row("b"), dt, 145);
  await waitFor(() => expect(placeWorkspace).toHaveBeenLastCalledWith("/d", "/c"));
});

it("reports a host failure without reloading as if the order had changed", async () => {
  const { reload, onError } = draw({ reject: true });
  await drag("c", "a", 105);
  await waitFor(() => expect(onError).toHaveBeenCalledOnce());
  expect(reload).not.toHaveBeenCalled();
});
