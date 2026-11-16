// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MockPort } from "../port/mock";
import { WorkbenchPanel } from "./WorkbenchPanel";
import { Composer } from "./Composer";
import "./testkit";

const props = (port: MockPort) => ({
  port, workspaceRoot: "/work/project", tabs: [], manual: false, shown: true, scheme: "light" as const,
  changes: [], onCloseManual: vi.fn(), onExternal: vi.fn(),
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Both({ port, onSubmit }: { port: MockPort; onSubmit: (text: string) => Promise<boolean> }) {
  const [inject, setInject] = useState({ n: 0, text: "" });
  return (
    <>
      <WorkbenchPanel {...props(port)} onAddToChat={(reference) => setInject((was) => ({ n: was.n + 1, text: reference }))} />
      <Composer port={port} status={null} running={false} inject={inject} onSubmit={onSubmit} onChanged={vi.fn()} onError={vi.fn()} />
    </>
  );
}

/** The listing the kernel actually returns: one level at a time. A nested file
 *  arrives only after its folder has been opened, which is also what draws its
 *  row — the tree starts every folder closed. */
function oneLevelAtATime(path: string, folder: boolean) {
  const parent = folder ? "" : path.split("/").slice(0, -1).join("/");
  return async (at = "") => {
    if (folder) return at === "" ? { files: [], directories: [path] } : { files: [], directories: [] };
    if (at === parent) return { files: [path], directories: [] };
    if (parent === "") return { files: [], directories: [] };
    return at === "" ? { files: [], directories: [parent] } : { files: [], directories: [] };
  };
}

async function openMenuOn(path: string) {
  fireEvent.contextMenu(await screen.findByRole("button", { name: (name) => name.trim() === path.split("/").at(-1) }));
  return screen.getByRole("menuitem", { name: "加入对话" }) as HTMLButtonElement;
}

it.each([
  ["src/two words.ts", false, "@src/two\\ words.ts"],
  ["docs", true, "@docs/"],
])("adds %j to the conversation as the same reference Copy reference gives", async (path, folder, reference) => {
  const user = userEvent.setup();
  const port = new MockPort();
  vi.spyOn(port, "workspaceFiles").mockImplementation(oneLevelAtATime(path, folder));
  const submit = vi.spyOn(port, "submit");
  const onSubmit = vi.fn().mockResolvedValue(true);
  render(<Both port={port} onSubmit={onSubmit} />);
  const box = screen.getByRole("combobox", { name: "任务输入" }) as HTMLTextAreaElement;
  await user.click(box);
  await user.keyboard("look at ");
  if (!folder && path.includes("/")) {
    // A nested file lives behind its folder, exactly as the kernel lists it.
    await user.click(await screen.findByRole("button", { name: path.split("/").slice(0, -1).join("/") }));
  }
  await user.click(await openMenuOn(path));
  await waitFor(() => expect(box.value).toBe(`look at ${reference} `));
  expect(document.activeElement).toBe(box);
  expect(submit).not.toHaveBeenCalled();
  await user.keyboard("please{Enter}");
  await waitFor(() => expect(onSubmit.mock.calls[0]?.[0]).toBe(`look at ${reference} please`));
});

it("puts a space before the reference when the caret follows a word, and keeps what follows", async () => {
  const user = userEvent.setup();
  const port = new MockPort();
  vi.spyOn(port, "workspaceFiles").mockResolvedValue({ files: ["a.ts"], directories: [] });
  render(<Both port={port} onSubmit={vi.fn().mockResolvedValue(true)} />);
  const box = screen.getByRole("combobox", { name: "任务输入" }) as HTMLTextAreaElement;
  await user.click(box);
  await user.keyboard("compare with this");
  await act(async () => { box.setSelectionRange(7, 7); fireEvent.click(box); });
  await user.click(await openMenuOn("a.ts"));
  await waitFor(() => expect(box.value).toBe("compare @a.ts with this"));
});

it("offers nothing to add for a name that cannot be written as a reference", async () => {
  const port = new MockPort();
  vi.spyOn(port, "workspaceFiles").mockResolvedValue({ files: ["github:notes.md"], directories: [] });
  render(<Both port={port} onSubmit={vi.fn().mockResolvedValue(true)} />);
  const item = await openMenuOn("github:notes.md");
  expect(item.disabled).toBe(true);
  expect(item.title).toBe("此名称可能被识别为 MCP 资源");
});
