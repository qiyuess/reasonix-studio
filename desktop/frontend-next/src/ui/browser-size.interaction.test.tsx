// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { BrowserPanel } from "./BrowserPanel";
import { BrowserSizeBar } from "./BrowserSizeBar";
import { CUSTOM, presetOf, type Chosen } from "./browserSize";

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
  it("starts on the device the toolbar leaves selected", () => {
    open();
    expect(canvas()).not.toBeNull();
    expect(viewport()?.style.width).toBe("412px");
    expect(viewport()?.style.height).toBe("914px");
    expect(screen.getByRole("button", { name: /Samsung Galaxy A51\/71/ })).toBeTruthy();
  });

  it("frames the page at a device chosen from the row", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: /Samsung Galaxy A51\/71/ }));
    await user.click(screen.getByRole("menuitem", { name: /iPhone 12 Pro/ }));
    expect(viewport()?.style.width).toBe("390px");
    expect(viewport()?.style.height).toBe("844px");
    expect(screen.getByRole("button", { name: /iPhone 12 Pro/ })).toBeTruthy();
  });

  it("keeps the device's name after rotating it", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: /Samsung Galaxy A51\/71/ }));
    await user.click(screen.getByRole("menuitem", { name: /iPhone 12 Pro/ }));
    await user.click(screen.getByRole("button", { name: "旋转" }));
    expect(viewport()?.style.width).toBe("844px");
    expect(viewport()?.style.height).toBe("390px");
    expect(screen.getByRole("button", { name: /iPhone 12 Pro/ })).toBeTruthy();
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
    expect(viewport()?.style.height).toBe("914px");
  });

  // Typing a size leaves the device behind: Chrome calls that row Responsive,
  // and a page still answering with a phone's UA while the row says another
  // size would be the row and the page disagreeing.
  it("switches to Responsive when a side is typed", async () => {
    const user = userEvent.setup();
    open();
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.type(width, "500{Enter}");
    expect(screen.getByRole("button", { name: /自适应/ })).toBeTruthy();
  });

  // Chrome's Edit opens the device editor without committing a change. Here the
  // fields are that editor, so focusing them must not drop the device first.
  it("opens the fields on Edit without changing the device", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: /Samsung Galaxy A51\/71/ }));
    await user.click(screen.getByRole("menuitem", { name: /iPhone 12 Pro/ }));
    await user.click(screen.getByRole("button", { name: /iPhone 12 Pro/ }));
    await user.click(screen.getByRole("menuitem", { name: /修改/ }));
    expect(viewport()?.style.width).toBe("390px");
    expect(viewport()?.style.height).toBe("844px");
    expect(screen.getByRole("button", { name: /iPhone 12 Pro/ })).toBeTruthy();
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.type(width, "500{Enter}");
    expect(viewport()?.style.width).toBe("500px");
    expect(screen.getByRole("button", { name: /自适应/ })).toBeTruthy();
  });

  // The panel's own size is not a device's rectangle. Once it is picked, the
  // row must not name whichever device happens to share those numbers when the
  // frame comes back.
  it("does not name a device after the panel's own size is chosen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const frame: Chosen = {
      width: 390, height: 844, mode: "fit", framed: true, preset: "iphone-12-pro",
      device: { mobile: true, dpr: 3, ua: "iPhone" },
    };
    render(<BrowserSizeBar size={frame} onChange={onChange} panel />);
    await user.click(screen.getByRole("button", { name: /iPhone 12 Pro/ }));
    await user.click(screen.getByRole("menuitem", { name: "面板大小" }));
    const next = onChange.mock.calls[0]?.[0] as Chosen;
    expect(next).toMatchObject({ framed: false, device: null, preset: CUSTOM });
    expect(presetOf({ ...next, framed: true })).toBe(CUSTOM);
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
    expect(viewport()?.style.width).toBe("412px");
  });

  it("puts the frame back when the field is left empty", async () => {
    const user = userEvent.setup();
    open();
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.tab();
    expect(width).toHaveProperty("value", "412");
    expect(viewport()?.style.width).toBe("412px");
  });

  it("follows the other side when the ratio is locked", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "锁定宽高比" }));
    const width = screen.getByRole("textbox", { name: "宽度" });
    await user.clear(width);
    await user.type(width, "824{Enter}");
    expect(viewport()?.style.width).toBe("824px");
    // 412 × 914 doubled, so the ratio the frame started at is kept.
    expect(viewport()?.style.height).toBe("1828px");
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
