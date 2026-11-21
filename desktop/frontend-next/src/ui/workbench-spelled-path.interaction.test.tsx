// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./testkit";
import { WorkbenchPanel } from "./WorkbenchPanel";
import { useConversationFiles } from "./useConversationFiles";
import { MockPort } from "../port/mock";
import { host } from "../port/host";
import type { AgentPort } from "../port/port";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const tabs = () => [...document.querySelectorAll("[role=tab]")].map((e) => e.textContent?.trim());

// A conversation link, opened the way the transcript opens one: through
// useConversationFiles, into the panel that reads the file.
function Harness({ port, link, root = "/w" }: { port: AgentPort; link: string; root?: string }) {
  const files = useConversationFiles(port, root, false, true, () => {}, () => {});
  return (
    <>
      <button onClick={() => files.refs.link?.(link)?.()}>link</button>
      <WorkbenchPanel scheme="dark" shown manual tabs={[]} changes={[]} onCloseManual={vi.fn()} onExternal={vi.fn()}
        port={port} fileRequest={files.request} workspaceRoot={root} />
    </>
  );
}

async function draw(port: MockPort, link: string) {
  vi.spyOn(host(), "describe").mockResolvedValue({ ...await host().describe(), platform: "darwin" });
  render(<Harness port={port} link={link} />);
  await userEvent.click(screen.getByText("link"));
}

describe("a file the conversation spelled from another directory", () => {
  it("opens where it really lives instead of reporting it gone", async () => {
    const spelled = "target/release/app.exe";
    const real = "misyrup-rs/target/release/app.exe";
    const port = new MockPort();
    vi.spyOn(port, "workspaceFile").mockImplementation(async (path) => {
      if (path !== real) throw Object.assign(new Error("missing"), {});
      return { path, content: "the file that is really there", revision: "1" };
    });
    const resolve = vi.spyOn(port, "workspaceResolvePath").mockResolvedValue({ path: real });
    await draw(port, spelled);

    // The wait is bounded, so the call carries a signal the lookup can be
    // abandoned with.
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(spelled, expect.anything()));
    await waitFor(() => expect(tabs()).toContain("app.exe"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("takes the path as written when it is already right, without a second tab", async () => {
    const spelled = "docs/notes.md";
    const port = new MockPort();
    vi.spyOn(port, "workspaceResolvePath").mockResolvedValue({ path: spelled });
    await draw(port, spelled);
    await waitFor(() => expect(tabs()).toContain("notes.md"));
    expect(tabs()).toHaveLength(1);
  });

  it("leaves the missing state standing when the workspace cannot say where it is", async () => {
    const port = new MockPort();
    vi.spyOn(port, "workspaceFile").mockRejectedValue(Object.assign(new Error("missing"), {}));
    const resolve = vi.spyOn(port, "workspaceResolvePath").mockResolvedValue(null);
    await draw(port, "target/release/gone.exe");
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  // Two presses in quick succession: the slower answer belongs to the older
  // press, and letting it land would show a file nobody asked for last.
  it("keeps the later link when the earlier answer arrives too late", async () => {
    const port = new MockPort();
    let releaseFirst: (v: { path: string } | null) => void = () => {};
    const first = new Promise<{ path: string } | null>((resolve) => { releaseFirst = resolve; });
    vi.spyOn(port, "workspaceResolvePath")
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => ({ path: "second/notes.md" }));

    function TwoLinks() {
      const files = useConversationFiles(port, "/w", false, true, () => {}, () => {});
      return (
        <>
          <button onClick={() => files.refs.link?.("slow/one.md")?.()}>first</button>
          <button onClick={() => files.refs.link?.("second/two.md")?.()}>second</button>
          <WorkbenchPanel scheme="dark" shown manual tabs={[]} changes={[]} onCloseManual={vi.fn()} onExternal={vi.fn()}
            port={port} fileRequest={files.request} workspaceRoot="/w" />
        </>
      );
    }
    render(<TwoLinks />);
    await userEvent.click(screen.getByText("first"));
    await userEvent.click(screen.getByText("second"));
    await waitFor(() => expect(tabs()).toContain("notes.md"));

    // Now let the stale answer land. It must not reach the panel.
    releaseFirst({ path: "slow/one.md" });
    await new Promise((r) => setTimeout(r, 50));
    expect(tabs()).toEqual(["notes.md"]);
  });

  it("does not ask a remote workspace, whose path names its own disk", async () => {
    const port = new MockPort();
    const resolve = vi.spyOn(port, "workspaceResolvePath");
    vi.spyOn(host(), "describe").mockResolvedValue({ ...await host().describe(), platform: "darwin" });
    function Remote() {
      const files = useConversationFiles(port, "/w", true, true, () => {}, () => {});
      return <button onClick={() => files.refs.link?.("a/b.md")?.()}>link</button>;
    }
    render(<Remote />);
    await userEvent.click(screen.getByText("link"));
    expect(resolve).not.toHaveBeenCalled();
  });
});
