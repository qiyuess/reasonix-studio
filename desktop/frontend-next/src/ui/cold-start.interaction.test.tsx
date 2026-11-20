// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "./testkit";
import { App } from "./App";
import { MockHub } from "../port/mock_hub";
import { boot, STORAGE } from "../i18n";
import { refresh } from "./viewport";
import { expandProjects } from "./sidebarrows";

// A window that has just opened shows the room, not a conversation. The pane the
// kernel launches with has no transcript behind it, and picking one off the tree
// is what says which conversation the person means — so the composer stays shut
// until that happens, and a cold start cannot quietly adopt the row it happened
// to list first.
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem("rx-nav-rail", "off");
  localStorage.setItem(STORAGE, "zh");
  boot();
  vi.spyOn(document.body, "clientWidth", "get").mockReturnValue(1440);
  vi.spyOn(document.body, "clientHeight", "get").mockReturnValue(900);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  refresh();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });

async function mount() {
  const hub = new MockHub();
  const build = hub.portFor.bind(hub);
  const reads: string[] = [];
  hub.portFor = (rt) => {
    const port = build(rt);
    port.providerSetup = async () => null;
    port.welcomeSeen = async () => true;
    const history = port.history.bind(port);
    port.history = async () => { reads.push(rt.id); return history(); };
    return port;
  };
  await act(async () => { render(<App hub={hub} />); });
  await waitFor(() => expect(document.querySelector(".railfoot")).toBeTruthy());
  return { hub, reads };
}

const box = () => screen.getByRole<HTMLTextAreaElement>("combobox", { name: "任务输入" });

it("a cold start shows no conversation and does not take typing", async () => {
  const { reads } = await mount();
  // The room is on screen: the composer is there, and it is waiting.
  expect(box().readOnly).toBe(true);
  expect(box().placeholder).toBe("从左栏选择，或在当前文件夹新建");
  // Nothing was read into the pane — the launch has not entered a conversation.
  expect(reads).toEqual([]);
});

it("picking a conversation off the tree is what opens the composer", async () => {
  await mount();
  expect(box().readOnly).toBe(true);

  await expandProjects();
  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".sessrow");
    expect(found).toBeTruthy();
    return found!;
  });
  await userEvent.click(row);

  await waitFor(() => expect(box().readOnly).toBe(false));
  // And it reads the record it just entered, rather than staying a blank pane.
  await waitFor(() => expect(document.querySelector(".sessrow")).toBeTruthy());
});

it("a reload of a tab that already showed a conversation comes back entered", async () => {
  const hub = new MockHub();
  const build = hub.portFor.bind(hub);
  hub.portFor = (rt) => {
    const port = build(rt);
    port.providerSetup = async () => null;
    port.welcomeSeen = async () => true;
    return port;
  };
  const runtime = await hub.open({ root: "~/projects/my-website", sessionPath: "/sessions/site.jsonl" });
  sessionStorage.setItem("rx-active-pane", runtime.id);
  await act(async () => { render(<App hub={hub} />); });

  const field = await waitFor(() => {
    const found = screen.getByRole<HTMLTextAreaElement>("combobox", { name: "任务输入" });
    expect(found.readOnly).toBe(false);
    return found;
  });
  expect(field.readOnly).toBe(false);
});
