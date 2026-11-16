import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLink } from "./useLink";
import type { Link } from "./useLink";
import { loadConnections } from "../net/savedConnections";
import type { Connection } from "../net/connection";
import type { NetworkStatus } from "../net/network";
import type { ProxyConfig } from "../net/server";

const serverMock = vi.hoisted(() => ({
  refreshProxy: vi.fn(),
  readProxyConfig: vi.fn(),
  answeringOrigins: vi.fn(),
  readMachineIdentity: vi.fn(),
}));
vi.mock("../net/server", () => serverMock);

const relayMock = vi.hoisted(() => ({
  prefetchGrant: vi.fn(),
  relayState: vi.fn(() => "none"),
}));
vi.mock("../net/relay", () => relayMock);

vi.mock("../net/savedConnections", () => ({
  loadConnections: vi.fn(() => []),
  latestConnection: vi.fn(() => null),
  rememberConnection: vi.fn(),
  learnConnectionMachine: vi.fn(),
  directDoorForMachine: vi.fn(() => null),
  originName: vi.fn((origin: string) => origin),
  normalizeTarget: vi.fn((target: string) => target.replace(/\/$/, "")),
  machineKey: vi.fn((name: string) => name.trim().toLowerCase()),
  // Same rule as the real one: a neighbour address is private, a name is not.
  isRemoteOrigin: vi.fn((origin: string) => {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      if (!host || host === "localhost" || host.endsWith(".local")) return false;
      const parts = host.split(".").map(Number);
      const isAddress =
        parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
      if (!isAddress) return true;
      const [a = -1, b = -1] = parts;
      if (a === 10 || a === 127) return false;
      if (a === 192 && b === 168) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 169 && b === 254) return false;
      return true;
    } catch {
      return false;
    }
  }),
  originHost: vi.fn((origin: string) => {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      return "";
    }
  }),
}));

vi.mock("../net/standDown", () => ({
  loadStandDown: vi.fn(() => false),
  saveStandDown: vi.fn(),
  clearStandDown: vi.fn(),
}));

vi.mock("../net/door", () => ({
  openDoor: vi.fn(async () => ({
    ok: false as const,
    error: { code: "client.offline", message: "offline", retryable: true },
  })),
  failureFromError: vi.fn(() => ({
    code: "client.offline",
    message: "offline",
    retryable: true,
  })),
}));

const LAN = {
  origin: "http://192.168.5.2:56789",
  candidates: ["http://192.168.5.2:56789"],
  paired: true,
};

function status(overrides: Partial<NetworkStatus> = {}): NetworkStatus {
  return {
    connected: true,
    connectionType: "wifi",
    validated: true,
    networkKey: "w1",
    ...overrides,
  };
}

function fakeConnection() {
  const fake = {
    current: {
      reach: { kind: "ok" as "ok" | "unauthorized" },
      runtimes: [] as unknown[],
      stream: { kind: "idle" as const },
    },
    lost: false,
    quickCheck: vi.fn(async () => true),
    refresh: vi.fn(async () => true),
    /** Mirrors the real contract: the verdict follows the read and `reach`. */
    probeRoute: vi.fn(async (): Promise<"up" | "hiccup" | "down"> => {
      if (await fake.refresh()) return "up";
      return fake.current.reach.kind === "ok" ? "hiccup" : "down";
    }),
    resetFailures: vi.fn(),
    wakeStream: vi.fn(),
    subscribe: vi.fn((_listener: (snapshot: unknown) => void) => () => {}),
  };
  return fake;
}

let container: HTMLDivElement;
let root: Root | null = null;
let latest: Link | null = null;
let fake: ReturnType<typeof fakeConnection>;

function Probe({ connection }: { connection: Connection }) {
  latest = useLink(connection);
  return null;
}

async function mount(): Promise<void> {
  await act(async () => {
    root?.render(<Probe connection={fake as unknown as Connection} />);
  });
  await act(async () => {
    await latest?.noteConnected();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  latest = null;
  fake = fakeConnection();
  vi.clearAllMocks();
  serverMock.readProxyConfig.mockResolvedValue(LAN);
  serverMock.refreshProxy.mockResolvedValue(LAN);
  serverMock.answeringOrigins.mockResolvedValue([]);
  serverMock.readMachineIdentity.mockResolvedValue(null);
  // `clearAllMocks` clears calls, not implementations: a test that replaced
  // the saved rows would otherwise leak them into the next one.
  vi.mocked(loadConnections).mockReturnValue([]);
  relayMock.relayState.mockReturnValue("none");
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

describe("useLink network changes", () => {
  it("moves a proxy link to the neighbour address of the same computer", async () => {
    // The person connected from outside, through the proxy's name. Back on the
    // Wi-Fi, the same computer answers on its own address — strictly shorter.
    const PROXY = "https://agent.example.com";
    const proxied = { origin: PROXY, candidates: [PROXY], paired: true, direct: [LAN.origin] };
    serverMock.readProxyConfig.mockResolvedValue(proxied);
    serverMock.refreshProxy.mockResolvedValue(proxied);
    const saved = await import("../net/savedConnections");
    const door = await import("../net/door");
    vi.mocked(saved.loadConnections).mockReturnValue([
      { kind: "lan", target: PROXY, name: "外面", machine: "Mac-A", usedAt: 0, order: 0 },
    ] as never);
    vi.mocked(saved.directDoorForMachine).mockReturnValue({
      kind: "lan", target: LAN.origin, name: "家里", machine: "Mac-A", usedAt: 0, order: 1,
    } as never);
    vi.mocked(door.openDoor).mockResolvedValue({ ok: true, machine: "Mac-A" });

    await mount();
    expect(latest?.state.target).toBe(PROXY);

    act(() => latest?.preferLan());
    await flush();
    await flush();

    expect(vi.mocked(door.openDoor)).toHaveBeenCalledWith(
      expect.objectContaining({ target: LAN.origin }),
      expect.any(Function),
    );
    expect(latest?.state.target).toBe(LAN.origin);
  });

  it("stays on the proxy door when the list cannot name the computer", async () => {
    // Without a name there is nothing to match the two doors on, and guessing
    // would move the conversation to a different machine.
    const PROXY = "https://agent.example.com";
    const proxied = { origin: PROXY, candidates: [PROXY], paired: true, direct: [LAN.origin] };
    serverMock.readProxyConfig.mockResolvedValue(proxied);
    serverMock.refreshProxy.mockResolvedValue(proxied);
    const saved = await import("../net/savedConnections");
    const door = await import("../net/door");
    vi.mocked(saved.loadConnections).mockReturnValue([
      { kind: "lan", target: PROXY, name: "外面", usedAt: 0, order: 0 },
    ] as never);
    vi.mocked(door.openDoor).mockClear();

    await mount();
    act(() => latest?.preferLan());
    await flush();
    await flush();

    expect(vi.mocked(door.openDoor)).not.toHaveBeenCalled();
    expect(latest?.state.target).toBe(PROXY);
  });

  it("probes a live route when the network changes without a dropout", async () => {
    await mount();
    expect(latest?.state.phase).toBe("connected");
    fake.wakeStream.mockClear();

    act(() => latest?.noteNetwork(status({ networkKey: "w2", connectionType: "wifi" }), true));
    await flush();

    expect(fake.quickCheck).toHaveBeenCalledTimes(1);
    expect(fake.wakeStream).toHaveBeenCalledTimes(1);
    expect(latest?.state.phase).toBe("connected");
  });

  it("reconnects immediately when the route no longer answers", async () => {
    await mount();
    fake.quickCheck.mockResolvedValue(false);
    fake.refresh.mockResolvedValue(false);

    act(() => latest?.noteNetwork(status({ networkKey: "w2" }), true));
    await flush();

    expect(serverMock.refreshProxy).toHaveBeenCalled();
    expect(latest?.state.phase).not.toBe("connected");
  });

  it("keeps a live link through a dropout and reassesses when it returns", async () => {
    await mount();

    act(() =>
      latest?.noteNetwork(
        status({ connected: false, connectionType: "none", validated: false, networkKey: "" }),
        true,
      ),
    );
    expect(latest?.state.phase).toBe("connected");

    act(() => latest?.noteNetwork(status({ networkKey: "w2" }), true));
    await flush();

    expect(fake.quickCheck).toHaveBeenCalledTimes(1);
    expect(latest?.state.phase).toBe("connected");
  });

  it("does nothing when neither the key nor the link changed", async () => {
    await mount();

    act(() => latest?.noteNetwork(status(), false));
    await flush();
    act(() => latest?.noteNetwork(status(), false));
    await flush();

    expect(fake.quickCheck).not.toHaveBeenCalled();
    expect(latest?.state.phase).toBe("connected");
  });

  it("wakes the stream on a foreground, where no network change fires", async () => {
    // A resume is not a network change: the key is identical, so noteNetwork
    // returns early and never reaches the stream. Only reassess covers this,
    // which is the case that left a backgrounded phone stuck.
    await mount();
    fake.wakeStream.mockClear();
    fake.quickCheck.mockClear();

    act(() => latest?.reassess());
    await flush();

    expect(fake.quickCheck).toHaveBeenCalledTimes(1);
    expect(fake.wakeStream).toHaveBeenCalledTimes(1);
    expect(latest?.state.phase).toBe("connected");
  });

  it("does not probe on a foreground while a check is already running", async () => {
    // A burst of resumes must not stack probes.
    await mount();
    fake.quickCheck.mockClear();

    act(() => {
      latest?.reassess();
      latest?.reassess();
    });
    await flush();

    expect(fake.quickCheck).toHaveBeenCalledTimes(1);
  });

  it("reacts to a dead LAN stream instead of waiting for the watch timer", async () => {
    // A retrying stream is an event; the 30 s poll is not. Two retries rule
    // out a kernel restarting a single pane, so one short probe decides
    // whether the route is gone — and a dead one walks the doors at once.
    const saved = await import("../net/savedConnections");
    const door = await import("../net/door");
    const spare = "http://192.168.5.9:57074";
    vi.mocked(saved.loadConnections).mockReturnValue([
      { kind: "lan", target: LAN.origin, name: "Mac-A", machine: "Mac-A", usedAt: 0, order: 0 },
      { kind: "lan", target: spare, name: "Mac-A", machine: "Mac-A", usedAt: 0, order: 1 },
    ] as never);

    serverMock.readProxyConfig.mockResolvedValue(LAN);
    serverMock.refreshProxy.mockResolvedValue(LAN);
    serverMock.answeringOrigins.mockResolvedValue([spare]);

    await mount();
    fake.quickCheck.mockResolvedValue(false);
    fake.refresh.mockResolvedValue(false);
    vi.mocked(door.openDoor).mockClear();

    const listener = vi.mocked(fake.subscribe).mock.calls[0]?.[0];
    expect(listener).toBeDefined();
    act(() => {
      listener?.({ stream: { kind: "retrying", attempt: 2, afterMs: 500 } });
    });
    await flush();

    expect(fake.quickCheck).toHaveBeenCalled();
    expect(vi.mocked(door.openDoor).mock.calls.length).toBeGreaterThan(0);
  });

  it("keeps a working link's face while it tries the next door", async () => {
    // The session is still on screen; only the transport is being repaired.
    // Blinking back to "finding the computer" is what made a hiccup look like
    // a disconnection.
    await mount();
    fake.quickCheck.mockResolvedValue(false);
    let release: () => void = () => {};
    serverMock.refreshProxy.mockImplementation(
      () => new Promise<ProxyConfig | null>((resolve) => (release = () => resolve(LAN))),
    );

    act(() => latest?.noteNetwork(status({ networkKey: "w2" }), true));
    await flush();
    await flush();

    expect(latest?.state.phase).toBe("connected");
    expect(latest?.state.step).toBe("probe");

    release();
    await flush();
  });

  it("probes a missed door again before waiting out a backoff", async () => {
    // "The first address answered only after the second was already being
    // tried": the sweep at the start of the attempt is stale by the time the
    // walk has spent its budget. One more sweep before sleeping on the backoff
    // catches that, and costs one probe instead of a whole retry cycle.
    const second = "http://192.168.5.3:56789";
    const twoDoors = { ...LAN, candidates: [LAN.origin, second] };
    serverMock.readProxyConfig.mockResolvedValue(twoDoors);
    serverMock.refreshProxy.mockResolvedValue(twoDoors);

    await mount();
    fake.quickCheck.mockResolvedValue(false);
    fake.refresh.mockResolvedValue(false);
    // Nothing comes back on the second sweep either, so the attempt ends in a
    // backoff instead of starting over — otherwise the walk would loop and
    // every probe count would depend on how many rounds happened to run.
    serverMock.answeringOrigins.mockResolvedValue([]);
    serverMock.answeringOrigins.mockClear();

    act(() => latest?.noteNetwork(status({ networkKey: "w2" }), true));
    await flush();

    // A sweep covering every door proves nothing on its own; what only the
    // extra check produces is a probe of the missed address alone, after the
    // walk had already spent its budget on the other one.
    const singleMiss = serverMock.answeringOrigins.mock.calls.filter(
      ([targets]) => Array.isArray(targets) && targets.length === 1 && targets[0] === second,
    );
    expect(singleMiss.length).toBeGreaterThanOrEqual(1);
  });

  it("restarts at most once when a door keeps flapping across the probe deadline", async () => {
    // A door missed by the sweep and caught by the re-probe restarts the
    // attempt. That restart has to spend one retry: with the count still at
    // zero the next attempt enters the same branch, and two answers that
    // alternate — sweep misses, re-probe catches — ran the pair for ever
    // instead of falling back to a backoff.
    const second = "http://192.168.5.3:56789";
    const twoDoors = { ...LAN, candidates: [LAN.origin, second] };
    serverMock.readProxyConfig.mockResolvedValue(twoDoors);
    serverMock.refreshProxy.mockResolvedValue(twoDoors);

    await mount();
    fake.quickCheck.mockResolvedValue(false);
    fake.refresh.mockResolvedValue(false);

    serverMock.answeringOrigins.mockClear();
    let probes = 0;
    serverMock.answeringOrigins.mockImplementation(async () => {
      probes += 1;
      // Odd calls are the sweep at the top of an attempt and answer nothing;
      // even calls are the re-probe at the bottom and catch the door.
      return probes % 2 === 0 ? [second] : [];
    });

    act(() => latest?.noteNetwork(status({ networkKey: "w2" }), true));
    // `flush` alone does not reach the timer the restart is scheduled on.
    for (let round = 0; round < 10; round++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    // One restart is a sweep plus its re-probe. Anything past the second
    // attempt spending the retry means the loop is back.
    expect(probes).toBeLessThanOrEqual(4);
  });

  it("does not follow a LAN door the list proves is another computer", async () => {
    // The transport is not the only thing a handover must not change: the
    // saved list may hold a second computer's LAN address, and reaching it
    // would replace the project and transcript under the person.
    const saved = await import("../net/savedConnections");
    const door = await import("../net/door");
    const spare = "http://192.168.5.9:57074";
    vi.mocked(saved.loadConnections).mockReturnValue([
      { kind: "lan", target: LAN.origin, name: "Mac-A", machine: "Mac-A", usedAt: 0, order: 0 },
      { kind: "lan", target: spare, name: "Mac-B", machine: "Mac-B", usedAt: 0, order: 1 },
    ] as never);
    const twoDoors = { ...LAN, candidates: [LAN.origin, spare] };
    serverMock.readProxyConfig.mockResolvedValue(twoDoors);
    serverMock.refreshProxy.mockResolvedValue(twoDoors);
    serverMock.answeringOrigins.mockResolvedValue([spare]);
    fake.quickCheck.mockResolvedValue(false);
    fake.refresh.mockResolvedValue(false);

    await mount();
    act(() => latest?.noteNetwork(status({ networkKey: "w2" }), true));
    await flush();

    expect(
      vi.mocked(door.openDoor).mock.calls.some(([entry]) => entry.target === spare),
    ).toBe(false);
  });

});
