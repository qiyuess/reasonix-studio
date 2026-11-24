import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DispatchPage } from "./DispatchPage";
import type { TreeProject } from "../wire/tree";

const modelMocks = vi.hoisted(() => ({
  loadGlobalModels: vi.fn(),
}));

vi.mock("../net/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../net/models")>();
  return { ...actual, loadGlobalModels: modelMocks.loadGlobalModels };
});

let container: HTMLDivElement;
let root: Root | null = null;

const project: TreeProject = {
  root: "/work/app",
  name: "app",
  remembered: true,
  total: 0,
  remaining: 0,
  sessions: [],
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  // The page loads the model catalog on mount; the default read fails so a
  // test that does not care about models never touches the network.
  modelMocks.loadGlobalModels.mockReset();
  modelMocks.loadGlobalModels.mockResolvedValue({ ok: false, code: "test.unconfigured" });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

function mount(projects: TreeProject[]): void {
  root = createRoot(container);
  act(() => {
    root?.render(
      <DispatchPage
        projects={projects}
        onDispatch={vi.fn(async () => ({ ok: true as const }))}
        onSent={() => {}}
      />,
    );
  });
}

describe("DispatchPage", () => {
  it("adopts the first project when the tree arrives after the page opened", () => {
    mount([]);
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);

    act(() => {
      root?.render(
        <DispatchPage
          projects={[project]}
            onDispatch={vi.fn(async () => ({ ok: true as const }))}
          onSent={() => {}}
        />,
      );
    });

    const option = container.querySelector('[role="option"]') as HTMLButtonElement;
    expect(option.textContent).toContain("app");
    expect(option.getAttribute("aria-selected")).toBe("true");

    const input = container.querySelector(".dispatch-input") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "跑测试");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((container.querySelector(".dispatch-send") as HTMLButtonElement).disabled).toBe(false);
  });

  it("names the app's own folder 任务, never the directory word", () => {
    mount([{ ...project, root: "/data/auto", name: "auto", auto: true }]);
    const option = container.querySelector('[role="option"]') as HTMLButtonElement;
    expect(option.textContent).toContain("任务");
    expect(option.textContent).not.toContain("auto");
  });

  it("names the model the dispatch will use once the catalog arrives", async () => {
    modelMocks.loadGlobalModels.mockResolvedValue({
      ok: true,
      catalog: {
        current: "demo/demo-flash",
        label: "Demo Flash",
        default: "demo/demo-flash",
        models: [
          {
            ref: "demo/demo-flash",
            provider: "demo",
            model: "demo-flash",
            active: true,
            default: true,
            effort: "high",
            efforts: ["high", "mid"],
          },
        ],
      },
    });
    mount([project]);
    await act(async () => {});

    const chip = container.querySelector(".modelchip") as HTMLButtonElement;
    expect(chip.textContent).toContain("demo-flash");
    expect(chip.textContent).not.toContain("默认模型");
  });

  it("keeps the default-model label when the catalog cannot be read", async () => {
    modelMocks.loadGlobalModels.mockResolvedValue({ ok: false, code: "http.500" });
    mount([project]);
    await act(async () => {});

    const chip = container.querySelector(".modelchip") as HTMLButtonElement;
    expect(chip.textContent).toContain("默认模型");
  });
});
