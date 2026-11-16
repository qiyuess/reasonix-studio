// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { PhonePop } from "./PhonePop";
import { HttpError } from "../port/http_error";
import type { HubPort } from "../port/hub";
import type { ShareStatus } from "../port/share";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

const status = (open: boolean): ShareStatus => ({
  open, addresses: [{ ip: "10.0.0.2", interface: "en0", kind: "lan" }], devices: [], cloudDevices: [],
});

function hubWith(reads: ShareStatus[], offerShare: () => Promise<unknown>) {
  let at = 0;
  const shareStatus = vi.fn(async () => reads[Math.min(at++, reads.length - 1)]);
  return {
    hub: {
      shareStatus,
      offerShare: vi.fn(offerShare),
      shareRemember: vi.fn(async () => ({ remember: false })),
      setShareRemember: vi.fn(async (on: boolean) => ({ remember: on })),
    } as unknown as HubPort,
    shareStatus,
  };
}

const closed = new HttpError(409, "share closed", { code: "share.closed" });

// The door was open when the window last looked and shut elsewhere since:
// opening the card reads first and does not ask a shut door for a code.
it("does not ask for a code when the read on opening finds the door shut", async () => {
  // Read on mount, read again as the open door starts being watched, then
  // shut by the time the card opens.
  const { hub, shareStatus } = hubWith([status(true), status(true), status(false)], () => Promise.reject(closed));
  render(<PhonePop hub={hub} />);
  await waitFor(() => expect(shareStatus).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole("button", { name: "设备访问" }));
  await waitFor(() => expect(shareStatus).toHaveBeenCalledTimes(3));
  expect(hub.offerShare).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

// A failure in the card is said in the card, not somewhere else on screen.
it("says a failed code request inside the card", async () => {
  const { hub } = hubWith([status(true)], () => Promise.reject(closed));
  render(<PhonePop hub={hub} />);
  await userEvent.click(await screen.findByRole("button", { name: "设备访问" }));
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("手机访问已关闭，请先开启。"));
});

it("disconnects an Internet controller after the same two-step confirmation", async () => {
  const remote = {
    ...status(false),
    cloudDevices: [{ id: "cloud-a", name: "Web Studio", connectedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), ordinal: 1 }],
  };
  const revokeDevice = vi.fn(async () => ({ ...remote, cloudDevices: [] }));
  const hub = {
    shareStatus: vi.fn(async () => remote),
    offerShare: vi.fn(),
    revokeDevice,
    shareRemember: vi.fn(async () => ({ remember: false })),
  } as unknown as HubPort;
  render(<PhonePop hub={hub} />);
  await userEvent.click(await screen.findByRole("button", { name: "设备访问" }));
  const disconnect = await screen.findByRole("button", { name: "断开" });
  await userEvent.click(disconnect);
  expect(screen.getByRole("button", { name: "确认断开" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "确认断开" }));
  await waitFor(() => expect(revokeDevice).toHaveBeenCalledWith("cloud-a"));
});

it("puts the LAN pairing code above its expiry, with one way to get a new one", async () => {
  // The status has to carry the expiry the code was minted with: `useShare`
  // drops an offer the status has not heard of, as one the kernel withdrew.
  const expires = new Date(Date.now() + 60_000).toISOString();
  const remote = { ...status(true), origin: "http://10.0.0.2:41234", offerExpires: expires };
  const offerShare = vi.fn(async () => ({
    url: "http://10.0.0.2:41234/?code=abc",
    qr: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    expires,
  }));
  const hub = {
    shareStatus: vi.fn(async () => remote),
    offerShare,
    shareRemember: vi.fn(async () => ({ remember: false })),
  } as unknown as HubPort;
  render(<PhonePop hub={hub} />);
  await userEvent.click(await screen.findByRole("button", { name: "设备访问" }));
  expect(await screen.findByRole("img", { name: "配对二维码" })).toBeTruthy();
  const code = document.querySelector(".pc-code")!;
  // The picture, then the line saying how long it lasts, then the one button:
  // no side column, and nothing that copies the link.
  expect(code.querySelector("img")).not.toBeNull();
  expect(code.querySelector(".pc-when")?.textContent).toContain("局域网配对 · ");
  expect(code.querySelector(".pc-when")?.textContent).toContain("前有效");
  const acts = code.querySelectorAll(".pc-acts button");
  expect([...acts].map((b) => b.textContent)).toEqual(["换一个"]);
  expect(code.querySelector('[data-action="share.copy"]')).toBeNull();
  expect(offerShare).toHaveBeenCalledTimes(1);
});

it("labels Internet controllers by their ordinal, not their list position", async () => {
  const now = new Date().toISOString();
  const cloud = (id: string, ordinal: number) => ({ id, name: "Web Studio", connectedAt: now, lastSeen: now, ordinal });
  const remote = { ...status(false), cloudDevices: [cloud("b", 2), cloud("c", 3)] };
  const hub = { shareStatus: vi.fn(async () => remote), offerShare: vi.fn(), revokeDevice: vi.fn(), shareRemember: vi.fn(async () => ({ remember: false })) } as unknown as HubPort;
  render(<PhonePop hub={hub} />);
  await userEvent.click(await screen.findByRole("button", { name: "设备访问" }));
  await screen.findByText("设备 2");
  expect(screen.getByText("设备 3")).toBeTruthy();
  expect(screen.queryByText("设备 1")).toBeNull();
});

// The card's own address is what a phone can read out and type by hand — but the
// copy button hands over the pairing link, not that address. An address alone
// stops a browser that has not paired at "this device is not paired", which is
// the whole reason a code exists, so copying it was a dead end.
it("shows the address a phone types in, and copies the pairing link", async () => {
  const origin = "http://10.0.0.2:41234";
  const link = `${origin}/#pair=abc123`;
  const remote = { ...status(true), origin };
  const hub = {
    shareStatus: vi.fn(async () => remote),
    offerShare: vi.fn(async () => ({ url: link, qr: "<svg/>", expires: new Date(Date.now() + 60_000).toISOString() })),
    shareRemember: vi.fn(async () => ({ remember: false })),
  } as unknown as HubPort;
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<PhonePop hub={hub} />);
  await userEvent.click(await screen.findByRole("button", { name: "设备访问" }));

  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".pc-origin");
    expect(found).not.toBeNull();
    return found!;
  });
  // Read out, not copied: the row still shows the bare address.
  expect(row.querySelector("code")?.textContent).toBe(origin);
  // The whole value stays reachable when the column clips it.
  expect(row.querySelector("code")?.getAttribute("title")).toBe(origin);

  await userEvent.click(row.querySelector("button")!);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
  expect(row.querySelector("button")?.textContent).toBe("已复制");
});

// A shut door has no address to give: the row is not drawn at all, rather than
// drawn empty or with the last one it used.
it("draws no address row while the local door is shut", async () => {
  const remote = { ...status(false), origin: "http://10.0.0.2:41234" };
  const hub = {
    shareStatus: vi.fn(async () => remote),
    offerShare: vi.fn(),
    shareRemember: vi.fn(async () => ({ remember: false })),
  } as unknown as HubPort;
  render(<PhonePop hub={hub} />);
  await userEvent.click(await screen.findByRole("button", { name: "设备访问" }));
  await screen.findByRole("dialog");
  expect(document.querySelector(".pc-origin")).toBeNull();
});

// The switch lives in settings, once. A second one here was a door control in a
// card opened to read a code, and it is gone: what the card draws is the two
// channels.
it("leaves the door switch to settings and offers the two channels", async () => {
  const remote = { ...status(true), origin: "http://10.0.0.2:41234" };
  const hub = {
    shareStatus: vi.fn(async () => remote),
    offerShare: vi.fn(async () => ({ url: "", qr: "<svg/>", expires: new Date(Date.now() + 60_000).toISOString() })),
    shareRemember: vi.fn(async () => ({ remember: false })),
  } as unknown as HubPort;
  render(<PhonePop hub={hub} />);
  await userEvent.click(await screen.findByRole("button", { name: "设备访问" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.querySelector('[data-action="share.toggle"]')).toBeNull();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["局域网络", "代理网络"]);
});

// Switching the channel has to move both halves the reader came for: the address
// on screen, and the code — which is a one-shot credential minted per door, so
// the local one would be spent nowhere through the proxy.
it("switches the address and asks the proxy for its own code", async () => {
  const origin = "http://10.0.0.2:41234";
  const proxyOrigin = "https://agent.example.com";
  const expires = new Date(Date.now() + 60_000).toISOString();
  const remote = { ...status(true), origin, proxyOrigin, publicOrigin: proxyOrigin, offerExpires: expires };
  const offerShare = vi.fn(async (channel?: string) => ({
    channel,
    url: `${channel === "proxy" ? proxyOrigin : origin}/#pair=abc`,
    qr: "<svg/>",
    expires,
  }));
  const hub = {
    shareStatus: vi.fn(async () => remote),
    offerShare,
    shareRemember: vi.fn(async () => ({ remember: false })),
  } as unknown as HubPort;
  render(<PhonePop hub={hub} />);
  await userEvent.click(await screen.findByRole("button", { name: "设备访问" }));

  await waitFor(() => expect(document.querySelector(".pc-origin code")?.textContent).toBe(origin));
  expect(offerShare).toHaveBeenCalledWith("lan");

  await userEvent.click(screen.getByRole("tab", { name: "代理网络" }));
  await waitFor(() => expect(document.querySelector(".pc-origin code")?.textContent).toBe(proxyOrigin));
  expect(offerShare).toHaveBeenCalledWith("proxy");
});

// A machine with no proxy named has one door, so the tab for the other says so
// by being unusable rather than by opening onto nothing.
it("keeps the proxy channel shut when no proxy is named", async () => {
  const remote = { ...status(true), origin: "http://10.0.0.2:41234" };
  const hub = {
    shareStatus: vi.fn(async () => remote),
    offerShare: vi.fn(),
    shareRemember: vi.fn(async () => ({ remember: false })),
  } as unknown as HubPort;
  render(<PhonePop hub={hub} />);
  await userEvent.click(await screen.findByRole("button", { name: "设备访问" }));
  const proxy = screen.getByRole("tab", { name: "代理网络" }) as HTMLButtonElement;
  expect(proxy.disabled).toBe(true);
  expect((screen.getByRole("tab", { name: "局域网络" }) as HTMLButtonElement).disabled).toBe(false);
});
