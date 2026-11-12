// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockPort } from "../port/mock";
import { WorkbenchPanel } from "./WorkbenchPanel";

afterEach(() => { cleanup(); localStorage.clear(); });

const mount = () =>
  render(<WorkbenchPanel port={new MockPort()} tabs={[]} manual={false} shown scheme="light" changes={[]} onCloseManual={vi.fn()} onSurfaces={vi.fn()} onExternal={vi.fn()} />);

describe("the workbench start menu once the explorer is chosen", () => {
  // LOCAL FORK: upstream 2.61 replaced the start menu with a "Pick a file on
  // the left" prompt once the explorer opened. The tree beside it already says
  // that, and the prompt read as a second, empty panel beside it, so this fork
  // leaves the canvas empty until a file is actually picked.
  it("leaves the canvas empty instead of prompting to pick a file", async () => {
    const { container } = mount();
    expect(container.querySelector(".workbench-launcher")).not.toBeNull();
    fireEvent.click(container.querySelector('[data-action="workbench.launch-files"]')!);
    expect(container.querySelector(".workbench-body")!.hasAttribute("data-files")).toBe(true);
    expect(container.querySelector(".workbench-launcher")).toBeNull();
    expect(screen.queryByText("从左侧选一个文件")).toBeNull();
    expect(container.querySelector(".workbench-canvas .workbench-state")).toBeNull();
  });

  it("comes back when the explorer is hidden again", () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('[data-action="workbench.launch-files"]')!);
    fireEvent.click(container.querySelector('[aria-pressed="true"]')!);
    expect(container.querySelector(".workbench-launcher")).not.toBeNull();
  });
});
