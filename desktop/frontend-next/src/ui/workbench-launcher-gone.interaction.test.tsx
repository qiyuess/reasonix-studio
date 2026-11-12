// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockPort } from "../port/mock";
import { WorkbenchPanel } from "./WorkbenchPanel";

afterEach(() => { cleanup(); localStorage.clear(); });

const mount = () =>
  render(<WorkbenchPanel port={new MockPort()} tabs={[]} manual={false} shown scheme="light" changes={[]} onCloseManual={vi.fn()} onSurfaces={vi.fn()} onExternal={vi.fn()} />);

const body = (c: HTMLElement) => c.querySelector<HTMLElement>(".workbench-body")!;

describe("the workbench start menu once the explorer is chosen", () => {
  // LOCAL FORK: upstream 2.61 replaced the start menu with a "Pick a file on
  // the left" prompt in a second column beside the tree, so opening the
  // explorer showed an empty right-hand panel. 2.58 had one column, so this
  // fork gives the list the whole body until a tab is opened.
  it("gives the list the whole body instead of a prompt beside it", async () => {
    const { container } = mount();
    expect(container.querySelector(".workbench-launcher")).not.toBeNull();
    fireEvent.click(container.querySelector('[data-action="workbench.launch-files"]')!);
    expect(body(container).hasAttribute("data-files")).toBe(true);
    expect(body(container).hasAttribute("data-list-only")).toBe(true);
    expect(container.querySelector(".workbench-launcher")).toBeNull();
    expect(screen.queryByText("从左侧选一个文件")).toBeNull();
    expect(container.querySelector(".workbench-canvas .workbench-state")).toBeNull();
  });

  it("gives the canvas its column back as soon as a file is picked", async () => {
    const port = new MockPort();
    vi.spyOn(port, "workspaceFiles").mockResolvedValue({ files: ["a.md"], directories: [] });
    const { container } = render(<WorkbenchPanel port={port} tabs={[]} manual={false} shown scheme="light" changes={[]} onCloseManual={vi.fn()} onSurfaces={vi.fn()} onExternal={vi.fn()} />);
    fireEvent.click(container.querySelector('[data-action="workbench.launch-files"]')!);
    await waitFor(() => expect(container.querySelector('[data-action-click="workbench.file"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-action-click="workbench.file"]')!);
    await waitFor(() => expect(body(container).hasAttribute("data-list-only")).toBe(false));
    expect(body(container).hasAttribute("data-files")).toBe(true);
  });

  it("comes back when the explorer is hidden again", () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('[data-action="workbench.launch-files"]')!);
    fireEvent.click(container.querySelector('[aria-pressed="true"]')!);
    expect(container.querySelector(".workbench-launcher")).not.toBeNull();
    expect(body(container).hasAttribute("data-list-only")).toBe(false);
  });
});
