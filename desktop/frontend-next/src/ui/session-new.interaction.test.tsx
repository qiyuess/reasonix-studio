// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { App } from "./App";
import { MockHub } from "../port/mock_hub";
import { expandProjects } from "./sidebarrows";

afterEach(cleanup);

// The second folder the fixture knows. Working in it is what focuses it, and a
// new session must still not inherit it.
const SECOND = "~/projects/my-website";

// Where a new session lands is the whole claim: the fake kernel records what
// every open asked for. A new conversation belongs to no project — the pill on
// its composer is where one is chosen — so starting one while working in a
// folder must ask for no project rather than for that folder.
describe("a new session belongs to no project", () => {
  it("does not inherit the folder the window is working in", async () => {
    const hub = new MockHub();
    const asked: (string | undefined)[] = [];
    const open = hub.open.bind(hub);
    hub.open = async (req) => {
      asked.push(req.root);
      return open(req);
    };
    // Past onboarding: a window still asking for a key draws neither the rail
    // nor a panes area, and this is a claim about a window that is working.
    const build = hub.portFor.bind(hub);
    hub.portFor = (rt) => {
      const port = build(rt);
      port.providerSetup = async () => null;
      port.welcomeSeen = async () => true;
      return port;
    };

    render(<App hub={hub} />);

    // The list rests folded, so the conversations under a project have to be
    // opened before one can be picked. This presses the heading control, which
    // opens every project; it does not choose one.
    await expandProjects();
    expect((await screen.findByRole("treeitem", { name: /my-website/ })).getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(await screen.findByRole("treeitem", { name: /站点改版/ }));
    await waitFor(() => expect(asked).toEqual([SECOND]));

    asked.length = 0;
    // The button in the rail's head. It starts a conversation, and a
    // conversation that has no project yet asks for none: the folder the window
    // was working in is not inherited.
    const head = document.querySelector(".studio-rail-head") as HTMLElement;
    await userEvent.click(within(head).getByRole("button", { name: /新建会话/ }));
    await waitFor(() => expect(asked).toEqual([undefined]));
  });

  it("keeps a conversation's composer mounted while another is in front", async () => {
    const hub = new MockHub();
    const build = hub.portFor.bind(hub);
    hub.portFor = (rt) => {
      const port = build(rt);
      port.providerSetup = async () => null;
      port.welcomeSeen = async () => true;
      return port;
    };

    render(<App hub={hub} />);
    await expandProjects();

    const composer = await screen.findByRole("combobox", { name: "任务输入" });
    await userEvent.type(composer, "keep this draft");
    await userEvent.click(screen.getByRole("treeitem", { name: /上一次的会话/ }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "任务输入" })).not.toBe(composer));
    await userEvent.click(screen.getByRole("treeitem", { name: /并行会话演示/ }));

    expect((await screen.findByRole("combobox", { name: "任务输入" }) as HTMLTextAreaElement).value).toBe("keep this draft");
  });
});
