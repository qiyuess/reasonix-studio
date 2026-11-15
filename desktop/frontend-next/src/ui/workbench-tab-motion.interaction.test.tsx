// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { langOf } from "./fileKind";
import { leave, useEnteringTabs, useOpenSlide } from "./workbench_motion";
import { WorkbenchTabOverflow } from "./WorkbenchTabOverflow";
import { WorkbenchTabPicker } from "./WorkbenchTabPicker";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("tabs that move, as the WB-Frame board draws them", () => {
  it("brings in a tab that opened after the strip was drawn, and not the ones drawn with it", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ keys }) => useEnteringTabs(keys), { initialProps: { keys: ["file:a", "file:b"] } });
    expect([...result.current]).toEqual([]);
    rerender({ keys: ["file:a", "file:b", "browser:t1"] });
    expect([...result.current]).toEqual(["browser:t1"]);
    act(() => void vi.advanceTimersByTime(300));
    expect([...result.current]).toEqual([]);
  });

  it("closes at once where there is nothing to animate with", () => {
    const then = vi.fn();
    leave(document.createElement("div"), then);
    expect(then).toHaveBeenCalled();
  });

  it("colours Go, Python and sheets apart and leaves the rest alone", () => {
    expect(["a/b.go", "x.py", "q3.xlsx", "data.csv", "README.md"].map(langOf)).toEqual(["go", "python", "sheet", "sheet", undefined]);
  });

  it("says how many tabs are off-screen as +n, with nothing to press", async () => {
    // The picker at the front of the strip is the way to reach a hidden tab;
    // this is only the count, so it must not be a second control beside it.
    const { container } = render(<WorkbenchTabOverflow count={3} />);
    const mark = container.querySelector(".workbench-overflow")!;
    expect(mark.textContent).toBe("+3");
    expect(mark.getAttribute("title")).toBe("还有 3 项没有显示");
    expect(mark.querySelector("button")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    await userEvent.click(mark);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("draws nothing while every tab fits", () => {
    const { container } = render(<WorkbenchTabOverflow count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists every open tab to jump from, and marks the one showing", async () => {
    // Drawn even when the strip fits: the tail of a strip is out of reach the
    // moment two more files are opened, and closing tabs to get at one is not
    // a way to reach it.
    const onPick = vi.fn();
    render(<WorkbenchTabPicker
      tabs={[{ key: "file:a", label: "a.go" }, { key: "file:b", label: "b.go" }, { key: "browser:t1", label: "Browser" }]}
      active="file:b" onPick={onPick} />);

    await userEvent.click(screen.getByRole("button", { name: "切换到某个标签" }));
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((row) => row.textContent)).toEqual(["a.go", "b.go", "Browser"]);
    expect(rows[1].getAttribute("aria-current"), "the showing tab is the one marked").toBe("true");
    expect(rows[0].getAttribute("aria-current")).toBeNull();

    await userEvent.click(rows[2]);
    expect(onPick).toHaveBeenCalledWith("browser:t1");
    expect(screen.queryByRole("menu"), "picking closes the list").toBeNull();
  });

  it("has nothing to list before a tab is open", () => {
    const { container } = render(<WorkbenchTabPicker tabs={[]} active="" onPick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("ticks only the row that is showing", async () => {
    // Six tabs called "about:blank" carry no wording to compare, so the row
    // that is open has to be said without reading the names. This asserts what
    // the DOM can answer — one row carries `aria-current`, and every row has
    // the tick element for the stylesheet to reveal or hide. Whether the tick
    // ends up visible, and the wash behind the row, are CSS: jsdom computes no
    // stylesheet, so design/workbench.css holds them and a look confirms them.
    const tabs = Array.from({ length: 6 }, (_, i) => ({ key: `browser:t${i}`, label: "about:blank" }));
    render(<WorkbenchTabPicker tabs={tabs} active="browser:t3" onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "切换到某个标签" }));

    const rows = screen.getAllByRole("menuitem");
    expect(rows).toHaveLength(6);
    const marked = rows.filter((row) => row.querySelector(".workbench-picker-mark"));
    expect(marked, "every row carries the icon").toHaveLength(6);
    const shown = rows.filter((row) => row.getAttribute("aria-current") === "true");
    expect(shown, "one row is the current one").toHaveLength(1);
    expect(shown[0], "and it is the fourth").toBe(rows[3]);
  });

  it("slides the workbench in when it is brought out, and not when it is drawn already out", () => {
    const el = document.createElement("section");
    const animate = vi.fn(() => ({ finished: Promise.resolve() }));
    Object.assign(el, { animate });
    const ref = { current: el };
    const { rerender } = renderHook(({ shown }) => useOpenSlide(ref, shown), { initialProps: { shown: true } });
    expect(animate).not.toHaveBeenCalled();
    rerender({ shown: false });
    rerender({ shown: true });
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
