// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "../testkit";
import { WorkedLine } from "./WorkedLine";

afterEach(cleanup);

describe("the worked line", () => {
  it("says the turn is done and how long it ran, in the compact form", () => {
    const box = render(<WorkedLine ms={65_000} />).container;
    expect(box.querySelector(".rc-t")?.textContent).toBe("已完成 · 1m 5s");
    expect(box.querySelector(".rc-tick")).toBeTruthy();
  });

  it("names when the turn ran, from first second to last, when the kernel knows", () => {
    const at = new Date(2026, 9, 13, 14, 5).getTime();
    const box = render(<WorkedLine ms={65_000} startedAt={at} />).container;
    // Both ends are stamped in full: a turn read later has no "today" to be
    // relative to, and the end is the start plus the duration it reports.
    expect(box.querySelector(".rc-span")?.textContent).toBe("2026-10-13 14:05:00 ~ 2026-10-13 14:06:05");
    // The duration keeps its own place at the end of the line.
    expect(box.querySelector(".rc-t")?.textContent).toBe("已完成 · 1m 5s");
  });

  it("leaves the range out when the kernel does not say when the turn began", () => {
    const box = render(<WorkedLine ms={65_000} />).container;
    expect(box.querySelector(".rc-span")).toBeNull();
    expect(box.querySelector(".rc-ok")).toBeTruthy();
  });
});
