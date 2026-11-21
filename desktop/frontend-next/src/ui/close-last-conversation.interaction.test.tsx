// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { App } from "./App";
import { MockHub } from "../port/mock_hub";

afterEach(cleanup);

// Closing the last conversation is the state a launch starts in: the window is
// open, nothing has been entered, and the next step is the person's. It gets the
// room — a pane with its composer waiting — rather than a card explaining that
// nothing is open, which reads as the end of something instead of the start.
it("closing the last conversation leaves a room, not an empty card", async () => {
  const hub = new MockHub();
  const build = hub.portFor.bind(hub);
  hub.portFor = (rt) => {
    const port = build(rt);
    port.providerSetup = async () => null;
    port.welcomeSeen = async () => true;
    return port;
  };
  const { container } = render(<App hub={hub} />);

  // One pane, holding one conversation, is what the fixture opens with. The
  // composer starts locked — a launch has entered nothing — but there is a
  // conversation in it, so closing that row is a real close.
  const box = await screen.findByRole<HTMLTextAreaElement>("combobox", { name: "任务输入" });
  expect(box).toBeTruthy();

  const row = await waitFor(() => {
    const found = container.querySelector<HTMLElement>(".sessrow");
    expect(found).toBeTruthy();
    return found!;
  });
  fireEvent.contextMenu(row);
  await userEvent.click(await screen.findByRole("menuitem", { name: "关闭会话" }));

  // The card that says nothing is open must not be what is left behind.
  await waitFor(() => expect(container.querySelector(".panes-empty")).toBeNull());
  // What is left is the room: a composer that is on screen and waiting.
  const room = await screen.findByRole<HTMLTextAreaElement>("combobox", { name: "任务输入" });
  expect(room.readOnly).toBe(true);
});
