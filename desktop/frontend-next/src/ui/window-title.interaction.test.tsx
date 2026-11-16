// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { App } from "./App";
import { MockHub } from "../port/mock_hub";
import { setShowsSessionTabs } from "../state/prefs";
import { expandProjects } from "./sidebarrows";

beforeEach(() => setShowsSessionTabs(true));
afterEach(() => {
  cleanup();
  setShowsSessionTabs(false);
});

function hub() {
  const h = new MockHub();
  const build = h.portFor.bind(h);
  h.portFor = (rt) => {
    const port = build(rt);
    port.providerSetup = async () => null;
    return port;
  };
  return h;
}

const title = () => document.querySelector(".crumb b")?.textContent ?? "";
const paneTab = (name: string) =>
  screen.getAllByRole("tab").find((t) => t.textContent?.includes(name) && t.closest("[data-pane]"));

// The window's title, run pill and approval mode are the front pane's. They were
// written only when a pane reported, and a pane reports when something about it
// changes — so switching to a pane that is sitting still left the title naming
// the conversation that had last spoken. The rule this guards is the one the
// projection notes state: freshness that depends on a writer remembering to
// announce itself is one quiet pane away from stale.
describe("what the window says it is showing", () => {
  it("names the pane in front, including one that has nothing to report", async () => {
    render(<App hub={hub()} />);
    const first = await waitFor(() => {
      const t = title();
      if (!t) throw new Error("no title yet");
      return t;
    });

    await expandProjects();
    const rows = document.querySelectorAll(".sessrow");
    const other = [...rows].find((r) => !r.textContent?.includes(first));
    // A fixture that offers only one conversation cannot tell "the title
    // followed the front pane" from "there was nowhere else to go", so say that
    // here instead of passing quietly — which is what this guard used to do, for
    // as long as the project list rested folded and every `.sessrow` was hidden.
    expect(other, "the fixture needs a second conversation to switch to").toBeTruthy();
    await userEvent.click(other!);

    const opened = await waitFor(() => {
      const t = title();
      if (t === first) throw new Error("still the old pane");
      return t;
    });

    // Back to the first pane, which by now has nothing new to say.
    const back = paneTab(first);
    expect(back, "the first pane kept no tab to go back to").toBeTruthy();
    await userEvent.click(back!);
    await waitFor(() => expect(title()).toBe(first));

    const forward = paneTab(opened);
    await userEvent.click(forward!);
    await waitFor(() => expect(title()).toBe(opened));
  });
});
