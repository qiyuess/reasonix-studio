// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserPanel } from "./BrowserPanel";

afterEach(cleanup);

describe("BrowserPanel", () => {
  it("opens a typed address when Enter is pressed", async () => {
    const user = userEvent.setup();
    const external = vi.fn();
    render(<BrowserPanel id="b0" scheme="light" onAddress={vi.fn()} onExternal={external} />);
    expect(screen.getByTitle("Reasonix 内置 Browser").querySelector(".lucide-globe")).not.toBeNull();

    const address = screen.getByRole("textbox", { name: "网页地址" });
    await user.clear(address);
    await user.type(address, "example.com/docs{Enter}");

    expect((address as HTMLInputElement).value).toBe("https://example.com/docs");
    expect(screen.getByTitle("Reasonix 内置 Browser").getAttribute("src")).toBe("https://example.com/docs");
    const toolbar = document.querySelector(".studio-browser-toolbar")!;
    const outside = toolbar.querySelector<HTMLButtonElement>('[data-action="browser.external"]')!;
    expect(outside.querySelector(".lucide-external-link")).not.toBeNull();
    await user.click(outside);
    expect(external).toHaveBeenCalledWith("https://example.com/docs");
    const frame = screen.getByTitle("Reasonix 内置 Browser");
    await user.click(toolbar.querySelector('[data-action="browser.reload"]')!);
    expect(screen.getByTitle("Reasonix 内置 Browser")).not.toBe(frame);
    await user.click(toolbar.querySelector('[data-action="browser.back"]')!);
    // Back to the panel's own opening screen: it has no address to type, so the
    // field is empty rather than showing the internal `reasonix://start` token.
    expect((address as HTMLInputElement).value).toBe("");
    expect(screen.getByTitle("Reasonix 内置 Browser").getAttribute("src")).toBe(null);
    expect(outside.disabled).toBe(true);
  });

  it("keeps invalid addresses in the field and explains the error", async () => {
    const user = userEvent.setup();
    render(<BrowserPanel id="b0" scheme="dark" onAddress={vi.fn()} onExternal={vi.fn()} />);

    const address = screen.getByRole("textbox", { name: "网页地址" });
    await user.clear(address);
    await user.type(address, "file:///private{Enter}");

    expect(screen.getByRole("alert").textContent).toContain("请输入有效的 http 或 https 地址");
    expect(screen.getByTitle("Reasonix 内置 Browser").hasAttribute("src")).toBe(false);
  });

  it.each(["D:/DevCode/aglo.html", "D:\\DevCode\\aglo.html", "\\\\nas\\share\\x.html", "/Users/me/index.html"])(
    "refuses the path %s instead of reading its drive letter as a host",
    async (path) => {
      const user = userEvent.setup();
      render(<BrowserPanel id="b0" scheme="light" onAddress={vi.fn()} onExternal={vi.fn()} />);
      const address = screen.getByRole("textbox", { name: "网页地址" });
      await user.clear(address);
      await user.type(address, `${path.replace(/[{[]/g, "$&$&")}{Enter}`);
      expect(screen.getByRole("alert").textContent).toContain("http 或 https");
      expect(screen.getByTitle("Reasonix 内置 Browser").hasAttribute("src")).toBe(false);
    },
  );

  it("still opens a host and port, and a bare host, as web addresses", async () => {
    const user = userEvent.setup();
    render(<BrowserPanel id="b0" scheme="light" onAddress={vi.fn()} onExternal={vi.fn()} />);
    const address = screen.getByRole("textbox", { name: "网页地址" });
    await user.clear(address);
    await user.type(address, "localhost:3000/x{Enter}");
    expect(screen.getByTitle("Reasonix 内置 Browser").getAttribute("src")).toBe("http://localhost:3000/x");
  });

  it("opens with an empty field that says what to do with it", () => {
    // This panel's opening screen is `reasonix://start`, an internal token and
    // not an address: the field starts empty, and the hint is what tells the
    // person there is somewhere to type. Asserted here as well as on the agent's
    // panel, because they are two different inputs with two different states.
    render(<BrowserPanel id="b0" scheme="light" onAddress={vi.fn()} onExternal={vi.fn()} />);
    const address = screen.getByRole("textbox", { name: "网页地址" }) as HTMLInputElement;
    expect(address.value, "no internal token in the field").toBe("");
    expect(address.placeholder).toBe("输入网址");
  });

  it("stays on the opening screen when Enter arrives with an empty field", async () => {
    // The field being empty is now the normal state, so Enter on nothing is a
    // press that happens. It must not hand the frame an empty address.
    const user = userEvent.setup();
    render(<BrowserPanel id="b0" scheme="light" onAddress={vi.fn()} onExternal={vi.fn()} />);
    const frame = screen.getByTitle("Reasonix 内置 Browser");
    const before = frame.getAttribute("src");
    await user.type(screen.getByRole("textbox", { name: "网页地址" }), "{Enter}");
    expect(screen.getByTitle("Reasonix 内置 Browser").getAttribute("src")).toBe(before);
    expect(screen.queryByRole("alert"), "and says nothing failed").toBeNull();
  });
});
