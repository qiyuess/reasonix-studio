// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useNewConversation } from "./useNewConversation";
import type { RuntimeView } from "../port/hub";

// A new conversation belongs to no project, whichever pane happened to be in
// front: it opens in the app's own folder and the composer's pill is where a
// project is chosen when the task has one. The folder the pane in front was
// working in is not inherited.
it("starts a local conversation with no project", async () => {
  const open = vi.fn().mockResolvedValue(undefined);
  const remote = vi.fn().mockResolvedValue(undefined);
  const runtime = { id: "active", root: "/shared/project" } as RuntimeView;
  const { result } = renderHook(() => useNewConversation("active", [runtime], open, remote));
  await act(() => result.current());
  expect(open).toHaveBeenCalledWith({ noProject: true });
  expect(remote).not.toHaveBeenCalled();
});

// A pane on another machine is that machine's connection, and its folder is what
// the connection names: the far kernel has no "no project" answer to give.
it("keeps the folder of a pane on another machine", async () => {
  const open = vi.fn().mockResolvedValue(undefined);
  const remote = vi.fn().mockResolvedValue(undefined);
  const runtime = { id: "active", root: "/shared/project", host: "gpu" } as RuntimeView;
  const { result } = renderHook(() => useNewConversation("active", [runtime], open, remote));
  await act(() => result.current());
  expect(remote).toHaveBeenCalledWith("gpu", "/shared/project");
  expect(open).not.toHaveBeenCalled();
});
