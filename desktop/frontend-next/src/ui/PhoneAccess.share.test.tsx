// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import "./testkit";
import { issuableDoor, useShare } from "./PhoneAccess";
import type { HubPort } from "../port/hub";
import type { OfferChannel, ShareOffer, ShareStatus } from "../port/share";

afterEach(cleanup);

const expiry = () => new Date(Date.now() + 60_000).toISOString();

const offer = (channel: OfferChannel, code: string = channel): ShareOffer => ({
  channel,
  url: `http://door/${channel}/#pair=${code}`,
  qr: "<svg/>",
  expires: expiry(),
});

/** An open share on a reachable address, with whatever else a case needs. */
const openOn = (over: Partial<ShareStatus> = {}): ShareStatus => ({
  open: true,
  origin: "http://10.0.0.2:50000",
  addresses: [{ ip: "10.0.0.2", interface: "en0", kind: "lan" }],
  devices: [],
  cloudDevices: [],
  // The code on screen is dropped by an effect when the status stops carrying an
  // expiry, so every fixture here keeps one — it is the kernel's "still offered".
  offerExpires: expiry(),
  ...over,
});

/** A machine whose only address is loopback: no phone dials it, but a proxy on
 *  this machine can, which is the case the local channel used to answer with a
 *  link that led nowhere. */
const loopbackOnly = (over: Partial<ShareStatus> = {}) =>
  openOn({
    origin: "http://127.0.0.1:50000",
    addresses: [{ ip: "127.0.0.1", interface: "lo", kind: "loopback" }],
    publicOrigin: "https://agent.example.com",
    proxyOrigin: "https://agent.example.com",
    ...over,
  });

function hubOf(over: Partial<Record<keyof HubPort, unknown>>) {
  return {
    shareStatus: vi.fn(async () => openOn()),
    offerShare: vi.fn(async (channel: OfferChannel = "lan") => offer(channel)),
    shareRemember: vi.fn(async () => ({ remember: false })),
    ...over,
  } as unknown as HubPort;
}

describe("which door a code can come from", () => {
  it("names the proxy when the local door is only loopback", () => {
    expect(issuableDoor(loopbackOnly(), "lan")).toBe("proxy");
  });

  it("leaves a reachable local door alone", () => {
    expect(issuableDoor(openOn(), "lan")).toBe("lan");
  });

  it("keeps the door that was asked for when it is already the proxy", () => {
    expect(issuableDoor(openOn(), "proxy")).toBe("proxy");
  });

  // Neither door can issue here, and pretending otherwise would ask the kernel
  // a question it refuses. The panel answers this one by keeping its switch off,
  // so the door named stays the one the reader picked.
  it("keeps the local door when there is no proxy to fall back to", () => {
    expect(issuableDoor(loopbackOnly({ publicOrigin: undefined, proxyOrigin: undefined }), "lan")).toBe("lan");
  });
});

describe("minting a code for a door", () => {
  it("asks the proxy when the local door has no code to give, and moves the panel there", async () => {
    const asked: OfferChannel[] = [];
    const hub = hubOf({
      shareStatus: vi.fn(async () => loopbackOnly()),
      offerShare: vi.fn(async (channel: OfferChannel = "lan") => {
        asked.push(channel);
        return offer(channel);
      }),
    });
    const { result } = renderHook(() => useShare(hub, () => {}, false));
    await waitFor(() => expect(result.current.st?.open).toBe(true));

    await act(async () => {
      await result.current.newCode();
    });

    // Asking for the local door on loopback would be refused by the kernel and
    // leave the panel with nothing to show; the door that can issue is used.
    expect(asked).toEqual(["proxy"]);
    expect(result.current.offer?.channel).toBe("proxy");
    expect(result.current.channel).toBe("proxy");
  });

  it("drops an answer for the door the panel has left", async () => {
    let releaseProxy: ((value: ShareOffer) => void) | undefined;
    const hub = hubOf({
      shareStatus: vi.fn(async () => openOn({ publicOrigin: "https://agent.example.com", proxyOrigin: "https://agent.example.com" })),
      offerShare: vi.fn(
        (channel: OfferChannel = "lan") =>
          channel === "proxy"
            ? new Promise<ShareOffer>((resolve) => {
                releaseProxy = resolve;
              })
            : Promise.resolve(offer("lan")),
      ),
    });
    const { result } = renderHook(() => useShare(hub, () => {}, false));
    await waitFor(() => expect(result.current.st?.open).toBe(true));

    act(() => result.current.chooseChannel("proxy"));
    await waitFor(() => expect(releaseProxy).toBeDefined());
    act(() => result.current.chooseChannel("lan"));
    await waitFor(() => expect(result.current.offer?.channel).toBe("lan"));

    // The proxy's answer arrives after the panel went back: drawing it would put
    // a code on screen for a door nobody is looking at.
    act(() => releaseProxy?.(offer("proxy")));
    expect(result.current.offer?.channel).toBe("lan");
  });

  it("keeps the last code asked for when two land out of order", async () => {
    const pending: Array<(value: ShareOffer) => void> = [];
    const hub = hubOf({
      offerShare: vi.fn(
        () =>
          new Promise<ShareOffer>((resolve) => {
            pending.push(resolve);
          }),
      ),
    });
    const { result } = renderHook(() => useShare(hub, () => {}, false));
    await waitFor(() => expect(result.current.st?.open).toBe(true));

    act(() => {
      void result.current.newCode();
    });
    act(() => {
      void result.current.newCode();
    });
    await waitFor(() => expect(pending.length).toBe(2));

    // Each mint retires the previous screen code in the kernel, so the code on
    // screen has to be the one asked for last — not the one answered last.
    act(() => pending[1](offer("lan", "second")));
    await waitFor(() => expect(result.current.offer?.url).toContain("second"));
    act(() => pending[0](offer("lan", "first")));
    expect(result.current.offer?.url).toContain("second");
  });

  // A kernel that does not name the door it answered for is read as having
  // answered the one it was asked about. Falling back to "no match" instead
  // would drop every code an older kernel hands out, with nothing to explain it.
  it("draws a code from a kernel that names no door", async () => {
    const hub = hubOf({
      offerShare: vi.fn(async () => {
        const { channel: _channel, ...rest } = offer("lan");
        return rest as ShareOffer;
      }),
    });
    const { result } = renderHook(() => useShare(hub, () => {}, false));
    await waitFor(() => expect(result.current.st?.open).toBe(true));

    await act(async () => {
      await result.current.newCode();
    });

    expect(result.current.offer?.url).toContain("/lan/");
  });
});
