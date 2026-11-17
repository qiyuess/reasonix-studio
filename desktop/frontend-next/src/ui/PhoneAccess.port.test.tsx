// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { PhoneAccess } from "./PhoneAccess";
import type { HubPort } from "../port/hub";
import type { ShareStatus, OfferChannel } from "../port/share";

afterEach(cleanup);

const base: ShareStatus = {
  open: false, addresses: [{ ip: "10.0.0.2", interface: "en0", kind: "lan" }], devices: [], cloudDevices: [],
};

function rig(initial: ShareStatus) {
  let st = initial;
  const hub = {
    shareStatus: vi.fn(async () => st),
    setSharePort: vi.fn(async (port: number) => (st = { ...st, port: port || undefined })),
    openShare: vi.fn(async (ip: string) => (st = { ...st, open: true, origin: `http://${ip}:${st.port ?? 50000}` })),
    offerShare: vi.fn(async (channel: OfferChannel = "lan") => ({ channel, url: "", qr: "<svg/>", expires: new Date(Date.now() + 60_000).toISOString() })),
    shareRemember: vi.fn(async () => ({ remember: false })),
    setSharePublicOrigin: vi.fn(async (origin: string) => (st = { ...st, publicOrigin: origin || undefined })),
  };
  return { hub, ui: <PhoneAccess hub={hub as unknown as HubPort} onError={() => {}} /> };
}

const portField = () =>
  waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('[data-action="share.port"]');
    expect(el).not.toBeNull();
    return el!;
  });

it("saves a typed port when the field loses focus and leaves a shut door shut", async () => {
  const { hub, ui } = rig(base);
  render(ui);
  const field = await portField();
  await userEvent.type(field, "41234");
  await userEvent.tab();
  await waitFor(() => expect(hub.setSharePort).toHaveBeenCalledWith(41234));
  expect(hub.openShare).not.toHaveBeenCalled();
});

it("clearing the field sends zero, and an unchanged field sends nothing", async () => {
  const { hub, ui } = rig({ ...base, port: 41234 });
  render(ui);
  const field = await portField();
  expect(field.value).toBe("41234");
  await userEvent.click(field);
  await userEvent.tab();
  expect(hub.setSharePort).not.toHaveBeenCalled();
  await userEvent.clear(field);
  await userEvent.tab();
  await waitFor(() => expect(hub.setSharePort).toHaveBeenCalledWith(0));
});

it("moves an open door onto the new port", async () => {
  const { hub, ui } = rig({ ...base, open: true, origin: "http://10.0.0.2:50000" });
  render(ui);
  const field = await portField();
  await userEvent.type(field, "41234");
  await userEvent.tab();
  await waitFor(() => expect(hub.openShare).toHaveBeenCalledWith("10.0.0.2"));
  expect(hub.setSharePort).toHaveBeenCalledWith(41234);
});

const originField = () =>
  waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('[data-action="share.public-origin"]');
    expect(el).not.toBeNull();
    return el!;
  });

it("saves a typed reverse proxy address when the field loses focus", async () => {
  const { hub, ui } = rig(base);
  render(ui);
  const field = await originField();
  await userEvent.type(field, "https://agent.example.com");
  await userEvent.tab();
  await waitFor(() =>
    expect(hub.setSharePublicOrigin).toHaveBeenCalledWith("https://agent.example.com"),
  );
});

it("sends nothing when the reverse proxy address did not change, and clears it on empty", async () => {
  const { hub, ui } = rig({ ...base, publicOrigin: "https://agent.example.com" });
  render(ui);
  const field = await originField();
  expect(field.value).toBe("https://agent.example.com");
  await userEvent.click(field);
  await userEvent.tab();
  expect(hub.setSharePublicOrigin).not.toHaveBeenCalled();
  await userEvent.clear(field);
  await userEvent.tab();
  await waitFor(() => expect(hub.setSharePublicOrigin).toHaveBeenCalledWith(""));
});

// The name is read when the next door opens, so saving it must not move a door
// phones are already using — that would unpair them for a setting about where
// the following one listens.
it("leaves an open door where it is when the reverse proxy address changes", async () => {
  const { hub, ui } = rig({ ...base, open: true, origin: "http://10.0.0.2:50000" });
  render(ui);
  const field = await originField();
  await userEvent.type(field, "https://agent.example.com");
  await userEvent.tab();
  await waitFor(() => expect(hub.setSharePublicOrigin).toHaveBeenCalled());
  expect(hub.openShare).not.toHaveBeenCalled();
});
