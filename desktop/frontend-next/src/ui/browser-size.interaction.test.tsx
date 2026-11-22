// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { BrowserPanel } from "./BrowserPanel";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const open = (props: { onExternal?: () => void } = {}) =>
  render(<BrowserPanel id="b0" scheme="light" onAddress={vi.fn()} onExternal={props.onExternal ?? vi.fn()} />);

const viewport = () => document.querySelector<HTMLElement>(".studio-browser-viewport");
const canvas = () => document.querySelector(".studio-browser-canvas");

describe("the size a page is framed at", () => {
  // The frame is what the page is laid out in, so its box has to be the size
  // the person asked for — not the size of the panel around it.
  it("starts at a phone and frames the page at that size", () => {
    open();
    expect(canvas()).not.toBeNull();
    expect(viewport()?.style.width).toBe("393px");
    expect(viewport()?.style.height).toBe("852px");
  });

  it("frames the page at a preset chosen from the row", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: /手机/ }));
    await user.click(screen.getByRole("menuitem", { name: /平板/ }));
    expect(viewport()?.style.width).toBe("768px");
    expect(viewport()?.style.height).toBe("1024px");
  });

  // The two fields are the page's own CSS pixels: typing 393 is what makes the
  // page answer a phone's media queries.
  it("frames the page at a width typed into the row", async () => {
    const user = userEvent.setup();
    open();
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.type(width, "500{Enter}");
    expect(viewport()?.style.width).toBe("500px");
  });

  it("keeps the height when the width is typed", async () => {
    const user = userEvent.setup();
    open();
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.type(width, "500{Enter}");
    expect(viewport()?.style.height).toBe("852px");
  });

  // A field on its way to a number is not a size yet: clamping "5" to the floor
  // while somebody is still typing would fight them for the cursor.
  it("does not clamp a half-typed number", async () => {
    const user = userEvent.setup();
    open();
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.type(width, "5");
    expect(width).toHaveProperty("value", "5");
    expect(viewport()?.style.width).toBe("393px");
  });

  it("puts the frame back when the field is left empty", async () => {
    const user = userEvent.setup();
    open();
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.tab();
    expect(width).toHaveProperty("value", "393");
    expect(viewport()?.style.width).toBe("393px");
  });

  it("follows the other side when the ratio is locked", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "锁定宽高比" }));
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.type(width, "786{Enter}");
    expect(viewport()?.style.width).toBe("786px");
    // 393 × 852 doubled, so the ratio the frame started at is kept.
    expect(viewport()?.style.height).toBe("1704px");
  });

  // The choice outlives the tab: a page opened after this one is framed the
  // same way, which is what makes the row a setting rather than a mode.
  it("remembers the size for the next page", async () => {
    const user = userEvent.setup();
    open();
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.type(width, "640{Enter}");
    cleanup();
    open();
    expect(viewport()?.style.width).toBe("640px");
  });
});

describe("the toolbar over a framed page", () => {
  // Forward is the one control the row was missing: a page visited, left and
  // come back from has somewhere to go on to.
  it("offers forward once the page has been left and come back from", async () => {
    const user = userEvent.setup();
    open();
    const forward = document.querySelector<HTMLButtonElement>('[data-action="browser.forward"]')!;
    expect(forward.disabled).toBe(true);
    const address = screen.getByRole("textbox", { name: "网页地址" });
    await user.type(address, "example.com{Enter}");
    await user.click(document.querySelector('[data-action="browser.back"]')!);
    expect(document.querySelector<HTMLButtonElement>('[data-action="browser.forward"]')!.disabled).toBe(false);
  });
});
