/// <reference types="node" />
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ConnectScreen } from "./ConnectScreen";
import {
  configureProxy,
  disconnectProxy,
  probeUpstream,
  readProxyConfig,
} from "../net/server";
import type { ProxyConfig } from "../net/server";
import { forgetFleetPeer } from "../net/fleet";
import {
  loadBackgroundStatus,
  openBatterySettings,
  openNotificationSettings,
} from "../native/turn";
import { loadConnections, rememberConnection } from "../net/savedConnections";
import { loadHaptics } from "./haptics";
import { idleLink } from "../net/link";
import type { LinkError, LinkState } from "../net/link";
import { readFileSync } from "node:fs";

/**
 * ConnectScreen is the only place a phone can acquire a kernel, and the only
 * place a failed acquisition explains itself. These tests drive it in the
 * browser path (Capacitor reports non-native) so no Activity is involved.
 */
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor/app", () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })), exitApp: vi.fn() },
}));
vi.mock("../native/networkWatch", () => ({
  readNetworkStatus: vi.fn(async () => null),
  onNetworkChange: vi.fn(async () => ({ remove: vi.fn() })),
}));
vi.mock("@capacitor/clipboard", () => ({ Clipboard: { read: vi.fn(), write: vi.fn(async () => {}) } }));
vi.mock("@capacitor/barcode-scanner", () => ({
  CapacitorBarcodeScanner: { scanBarcode: vi.fn() },
  CapacitorBarcodeScannerCameraDirection: { BACK: "BACK" },
  CapacitorBarcodeScannerScanOrientation: { ADAPTIVE: "ADAPTIVE" },
  CapacitorBarcodeScannerTypeHint: { ALL: "ALL" },
}));
vi.mock("../native/login", () => ({ NativeLogin: { open: vi.fn(async () => {}) } }));
vi.mock("../native/pair", () => ({ NativePair: { pair: vi.fn() } }));
vi.mock("../native/webmode", () => ({ WebMode: { open: vi.fn(async () => {}) } }));
vi.mock("../native/turn", () => ({
  loadBackgroundStatus: vi.fn(async () => null),
  openBatterySettings: vi.fn(),
  openNotificationSettings: vi.fn(),
}));
vi.mock("../native/update", () => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  launchInstaller: vi.fn(),
  onUpdateProgress: vi.fn(async () => ({ remove: vi.fn() })),
}));
vi.mock("../net/relayStore", () => ({ clearRelayDevice: vi.fn(), loadRelayDevice: vi.fn(() => null) }));
vi.mock("../net/fleet", () => ({ forgetFleetPeer: vi.fn(async () => {}) }));
vi.mock("../net/relay", () => ({
  clearRelayRouting: vi.fn(),
  connectRelay: vi.fn(),
  relayAlive: vi.fn(() => false),
  prefetchGrant: vi.fn(),
  RelayError: class MockRelayError extends Error {
    readonly kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
    }
  },
}));
vi.mock("../net/server", () => ({
  readProxyConfig: vi.fn(),
  configureProxy: vi.fn(),
  refreshProxy: vi.fn(),
  listRemoteDevices: vi.fn(),
  markRelay: vi.fn(),
  clearRelay: vi.fn(),
  disconnectProxy: vi.fn(),
  signOutAccount: vi.fn(),
  signInAccount: vi.fn(),
  approveDevice: vi.fn(),
  startAccount: vi.fn(),
  pollAccount: vi.fn(),
  parseServerLink: vi.fn(),
  studioWebUrl: vi.fn(() => ""),
  studioAppUrl: vi.fn(() => ""),
  studioRemoteUrl: (device: string | null | undefined) => {
    const id = (device ?? "").trim();
    return id ? `https://reasonix.io/remote/?device=${encodeURIComponent(id)}` : "";
  },
  probeUpstream: vi.fn(),
  probeDoor: vi.fn(async () => ({ ok: true as const, machine: "" })),
  readMachineIdentity: vi.fn(async () => null),
  ProxyError: class MockProxyError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  },
}));
let container: HTMLDivElement;
let root: Root | null = null;
let onConnected: Mock<() => void>;

function config(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    origin: "http://192.168.5.2:56789",
    candidates: ["http://192.168.5.2:56789"],
    paired: true,
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  localStorage.clear();
  onConnected = vi.fn<() => void>();
  vi.clearAllMocks();
  vi.mocked(readProxyConfig).mockResolvedValue(config());
  vi.mocked(loadBackgroundStatus).mockResolvedValue(null);
  vi.mocked(configureProxy).mockResolvedValue(config());
  vi.mocked(probeUpstream).mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.clearAllMocks();
});

async function renderScreen(
  onClose?: () => void,
  props: {
    onFailed?: (error: LinkError) => void;
    link?: LinkState;
  } = {},
): Promise<void> {
  act(() => root?.unmount());
  root = createRoot(container);
  await act(async () => {
    root?.render(
      onClose ? (
        <ConnectScreen onConnected={onConnected} onClose={onClose} {...props} />
      ) : (
        <ConnectScreen onConnected={onConnected} {...props} />
      ),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function button(text: string): HTMLButtonElement {
  const matches = Array.from(container.querySelectorAll("button")).filter(
    (candidate) => candidate.textContent?.trim() === text,
  );
  // The settings tabs also carry one-word labels; an action with the same
  // name is never the tab.
  const found = matches.find((candidate) => !candidate.closest(".settings-tabs")) ?? matches[0];
  if (!found) throw new Error(`no button labelled ${text}`);
  return found;
}

/** A row whose label and subtitle are two lines: match on both. */
function row(...parts: string[]): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((candidate) => {
    const text = candidate.textContent ?? "";
    return parts.every((part) => text.includes(part));
  });
  if (!found) throw new Error(`no row containing ${parts.join(" + ")}`);
  return found;
}

function press(text: string): Promise<void> {
  return act(async () => {
    button(text).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function pressRow(...parts: string[]): Promise<void> {
  return act(async () => {
    row(...parts).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Drive a touch drag through the DOM, the way a finger would. */




/** jsdom has no PointerEvent; React only reads the fields the row uses. */
function pointer(node: Element, type: string, x: number, y: number): void {
  act(() => {
    node.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  });
}

/** A still press long enough for the row to be picked up. */
function hold(node: Element, x: number, y: number): void {
  pointer(node, "pointerdown", x, y);
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

describe("ConnectScreen", () => {

  it("fills the remembered origin and connects without a code", async () => {
    await renderScreen();

    const origin = container.querySelector("input") as HTMLInputElement;
    expect(origin.value).toMatch(/^http:\/\/192\.168\.5\.2:\d+$/);

    await press("连接这台电脑");

    expect(configureProxy).toHaveBeenCalledWith("http://192.168.5.2:56789", undefined);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("folds the manual address fields behind a disclosure", async () => {
    await renderScreen();

    const manual = container.querySelector("details.manual-group") as HTMLDetailsElement;
    expect(manual).not.toBeNull();
    expect(manual.open).toBe(false);
    expect(manual.querySelector("summary")?.textContent).toContain("手动填写地址");
    const origin = manual.querySelector("input") as HTMLInputElement;
    expect(origin.value).toMatch(/^http:\/\/192\.168\.5\.2:\d+$/);
  });

  it("keeps the address and the refused code in a pairing error", async () => {
    vi.mocked(configureProxy).mockRejectedValue(new Error("device.pairing_invalid"));
    await renderScreen();

    await press("连接这台电脑");

    expect(container.textContent).toContain("配对码已失效");
    expect(container.textContent).toContain("http://192.168.5.2:56789");
    expect(onConnected).not.toHaveBeenCalled();
  });

  
  
  
  
  it("disconnects on purpose and drops the shown upstream", async () => {
    vi.mocked(disconnectProxy).mockResolvedValue(
      config({ origin: "", candidates: ["http://192.168.5.2:56789"] }),
    );
    await renderScreen();

    await press("断开连接");

    expect(disconnectProxy).toHaveBeenCalledTimes(1);
    // The saved row survives (reconnect is one tap), the network row reads
    // as disconnected, the danger button is gone with the upstream, and the
    // manual form no longer carries the old origin.
    expect(container.textContent).toContain("未连接");
    expect(container.textContent).not.toContain("断开连接");
    const origin = container.querySelector(".manual-group input") as HTMLInputElement;
    expect(origin.value).toBe("");
  });

  it("offers a back control only when it has somewhere to go", async () => {
    const onClose = vi.fn();
    await renderScreen(onClose);
    await press("←");
    expect(onClose).toHaveBeenCalledTimes(1);

    await renderScreen();
    expect(container.querySelector('button[aria-label="返回"]')).toBeNull();
  });

  describe("appearance, posture and about", () => {
    beforeEach(() => {
      localStorage.clear();
      document.documentElement.removeAttribute("data-theme");
    });

    afterEach(() => {
      document.documentElement.removeAttribute("data-theme");
      document.documentElement.removeAttribute("data-style");
    });

    async function renderPrefs(): Promise<void> {
      await renderScreen();
      await press("偏好");
    }

    it("shows the transcript cache and clears it on request", async () => {
      await renderPrefs();

      expect(container.textContent).toContain("会话缓存");
      expect(container.textContent).toContain("保留会话内容");

      const clear = container.querySelector("button.setting") as HTMLButtonElement | null;
      expect(clear?.textContent).toContain("清理");
      await act(async () => {
        clear?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // jsdom has no IndexedDB, so the clear finds nothing — the point here is
      // that the row is wired to the cache at all.
      expect(container.textContent).toContain("没有可清理的会话缓存");
    });

    it("pins a theme and remembers it", async () => {
      await renderPrefs();

      await act(async () => {
        button("深色").click();
        await Promise.resolve();
      });

      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(localStorage.getItem("reasonix.theme")).toBe("dark");
    });

    it("goes back to following the system, which is the absent attribute", async () => {
      await renderPrefs();
      await act(async () => {
        button("深色").click();
        await Promise.resolve();
      });
      await act(async () => {
        button("跟随系统").click();
        await Promise.resolve();
      });

      expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
      expect(localStorage.getItem("reasonix.theme")).toBeNull();
    });

    it("remembers where a dispatch lands", async () => {
      await renderPrefs();

      await act(async () => {
        button("不跳转").click();
        await Promise.resolve();
      });
      expect(localStorage.getItem("reasonix.dispatch-after")).toBe("stay");

      await act(async () => {
        button("派发的会话").click();
        await Promise.resolve();
      });
      expect(localStorage.getItem("reasonix.dispatch-after")).toBe("session");

      await act(async () => {
        button("最近").click();
        await Promise.resolve();
      });
      expect(localStorage.getItem("reasonix.dispatch-after")).toBeNull();
    });

    it("pins the transcript fold and remembers it", async () => {
      await renderPrefs();

      const group = container.querySelector('[aria-label="会话详略"]');
      const compact = Array.from(group?.querySelectorAll("button") ?? []).find(
        (candidate) => candidate.textContent === "精简",
      ) as HTMLButtonElement;

      await act(async () => {
        compact.click();
        await Promise.resolve();
      });

      expect(localStorage.getItem("reasonix.folding.v1")).toBe("compact");
      expect(compact.getAttribute("aria-pressed")).toBe("true");
    });

    it("remembers the vibration switch", async () => {
      await renderPrefs();

      const toggle = container.querySelector(
        '[role="switch"][aria-label="震动"]',
      ) as HTMLButtonElement;
      expect(toggle.getAttribute("aria-checked")).toBe("true");

      await act(async () => {
        toggle.click();
        await Promise.resolve();
      });

      expect(toggle.getAttribute("aria-checked")).toBe("false");
      expect(loadHaptics()).toBe(false);
    });

    it("shows the version the build was given", async () => {
      await renderPrefs();
      expect(container.textContent).toContain("版本");
      // The value comes from `define`, so the test asserts it is not blank
      // rather than pinning a number that a release would change.
      const value = container.querySelector(".setting-value")?.textContent ?? "";
      expect(value.trim()).not.toBe("");
    });

    // A regression guard the browser cannot exercise: desktop Chromium never
    // reproduced the WebView drawing the pane-switch animation's compositor
    // layer over the sticky bar, so the only testable fact is that the bar
    // keeps its own layer. Removing the promotion is what made the tabs read
    // as content passing through them on the phone.
    it("keeps the settings bar on its own compositor layer", () => {
      const css = readFileSync("src/ui/connect.css", "utf8");
      expect(css).toMatch(/\.settings-bar\s*\{[^}]*transform:\s*translateZ\(0\)/);
    });

  });
});

describe("ConnectScreen saved connections", () => {
  it("records the current computer and marks it", async () => {
    await renderScreen();

    expect(container.textContent).toContain("已连接的电脑");
    const current = row("192.168.5.2:56789", "当前");
    expect(current).toBeTruthy();
    // The proxy's own origin is a record worth keeping even before a scan.
    expect(JSON.parse(localStorage.getItem("reasonix.connections.v1") ?? "[]")).toHaveLength(1);
  });

  it("switches to a saved computer with no code", async () => {
    rememberConnection("http://192.168.9.9:51234");
    await renderScreen();

    await pressRow("192.168.9.9:51234");
    expect(configureProxy).toHaveBeenCalledWith("http://192.168.9.9:51234", undefined);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("names the door this phone can reach directly", async () => {
    // One computer, two addresses: the Wi-Fi one is a neighbour, the mesh-VPN
    // one is only reachable through the tunnel. Both are saved rows, and the
    // person has to be able to tell which is the fast one.
    rememberConnection("http://172.16.2.59:57074");
    rememberConnection("http://192.168.5.3:57074");
    vi.mocked(readProxyConfig).mockResolvedValue(
      config({
        origin: "http://192.168.5.3:57074",
        candidates: ["http://172.16.2.59:57074", "http://192.168.5.3:57074"],
        preferred: ["http://192.168.5.3:57074", "http://172.16.2.59:57074"],
        direct: ["http://192.168.5.3:57074"],
      }),
    );

    await renderScreen();

    const direct = row("192.168.5.3:57074");
    const tunnel = row("172.16.2.59:57074");
    expect(direct?.textContent).toContain("可直连");
    expect(tunnel?.textContent).not.toContain("可直连");
  });

  it("says nothing about directness when the proxy named no order", async () => {
    rememberConnection("http://192.168.9.9:51234");
    await renderScreen();

    // A browser dev session has no interfaces to judge, so no row claims to
    // be the direct one.
    expect(container.textContent).not.toContain("可直连");
  });

  it("reorders the saved computers with a held drag", async () => {
    rememberConnection("http://192.168.9.9:51234");
    await renderScreen();
    vi.useFakeTimers();

    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-drag-key]"));
    rows.forEach((node, index) => {
      node.getBoundingClientRect = () =>
        ({
          top: index * 60,
          bottom: index * 60 + 60,
          height: 60,
          left: 0,
          right: 320,
          width: 320,
          x: 0,
          y: index * 60,
          toJSON: () => ({}),
        }) as DOMRect;
    });
    // The row saved before the screen opened keeps the first slot; the
    // proxy's own origin was appended when the screen read it.
    expect(rows[0]?.getAttribute("data-drag-key")).toBe("http://192.168.9.9:51234");
    const moving = rows[1] as HTMLElement;

    hold(moving, 160, 70);
    pointer(moving, "pointermove", 160, 10);
    pointer(moving, "pointerup", 160, 10);
    vi.useRealTimers();

    // The order is the retry order, so it has to reach storage rather than
    // live only in the screen that drew it.
    expect(loadConnections().map((entry) => entry.target)).toEqual([
      "http://192.168.5.2:56789",
      "http://192.168.9.9:51234",
    ]);
  });

  it("drags a computer and its doors as one block", async () => {
    // The drag key sits on the wrapper so a computer with doors is measured at
    // its real height; the drop indicator would otherwise land short. Moving
    // the wrapper has to carry both doors with it.
    rememberConnection("http://192.168.5.3:57074", "工作台", "studio-pc");
    rememberConnection("https://proxy.example.com", "工作台", "studio-pc");
    await renderScreen();
    vi.useFakeTimers();

    const groups = Array.from(container.querySelectorAll<HTMLElement>("[data-drag-key]"));
    groups.forEach((node, index) => {
      node.getBoundingClientRect = () =>
        ({
          top: index * 120,
          bottom: index * 120 + 120,
          height: 120,
          left: 0,
          right: 320,
          width: 320,
          x: 0,
          y: index * 120,
          toJSON: () => ({}),
        }) as DOMRect;
    });

    // One wrapper for the computer, listing both doors inside it.
    const studio = groups.find(
      (node) => node.getAttribute("data-drag-key") === "machine:studio-pc",
    );
    expect(studio).toBeTruthy();
    expect(studio?.querySelectorAll(".saved-row.door")).toHaveLength(2);

    const moving = studio as HTMLElement;
    hold(moving, 160, 130);
    pointer(moving, "pointermove", 160, 10);
    pointer(moving, "pointerup", 160, 10);
    vi.useRealTimers();

    // Both doors travelled together: one computer, one block.
    const rows = loadConnections();
    expect(rows.filter((saved) => saved.machine === "studio-pc")).toHaveLength(2);
  });

  it("asks before removing a saved computer", async () => {
    rememberConnection("http://192.168.9.9:51234");
    await renderScreen();

    act(() => {
      (
        container.querySelector('[aria-label="移除 192.168.9.9:51234"]') as HTMLButtonElement
      ).click();
    });

    expect(container.textContent).toContain("移除这台电脑？");
    expect(loadConnections().some((entry) => entry.target === "http://192.168.9.9:51234")).toBe(
      true,
    );

    await press("取消");

    expect(container.textContent).not.toContain("移除这台电脑？");
    expect(loadConnections().some((entry) => entry.target === "http://192.168.9.9:51234")).toBe(
      true,
    );
    expect(forgetFleetPeer).not.toHaveBeenCalled();
  });

  it("forgets a saved computer without touching the rest", async () => {
    rememberConnection("http://192.168.9.9:51234");
    await renderScreen();

    act(() => {
      (
        container.querySelector('[aria-label="移除 192.168.9.9:51234"]') as HTMLButtonElement
      ).click();
    });
    await press("移除");

    expect(container.textContent).not.toContain("192.168.9.9:51234");
    expect(container.textContent).toContain("192.168.5.2:56789");
    expect(forgetFleetPeer).toHaveBeenCalledWith("http://192.168.9.9:51234");
  });

  it("drops the link when the computer it is connected to is removed", async () => {
    // Removing the live computer has to disconnect as well. Every `connected()`
    // records the target again, so a removal that left the link up would be
    // undone by the next reconnect — the row would simply come back.
    vi.mocked(disconnectProxy).mockResolvedValue(config({ origin: "", candidates: [] }));
    rememberConnection("http://192.168.5.2:56789");
    await renderScreen();

    act(() => {
      (
        container.querySelector('[aria-label="移除 192.168.5.2:56789"]') as HTMLButtonElement
      ).click();
    });
    await press("移除");

    expect(disconnectProxy).toHaveBeenCalledTimes(1);
    // The row is gone from the list even though the link teardown is still in
    // flight; the saved list is written synchronously by the confirm.
    expect(container.textContent).not.toContain("移除 192.168.5.2:56789");
  });

  it("leaves the link alone when a different computer is removed", async () => {
    // The row being removed is not the one in use, so tearing the link down
    // would disconnect a working session for no reason.
    rememberConnection("http://192.168.9.9:51234");
    await renderScreen();

    act(() => {
      (
        container.querySelector('[aria-label="移除 192.168.9.9:51234"]') as HTMLButtonElement
      ).click();
    });
    await press("移除");

    expect(disconnectProxy).not.toHaveBeenCalled();
  });

  it("lists each address of one computer, so one can go without the other", async () => {
    // A LAN origin and a cloud id for the same machine are two doors. Removing
    // the computer because one address went stale would drop a route that
    // still works, so each door carries its own ×.
    rememberConnection("http://192.168.5.3:57074", "工作台", "studio-pc");
    rememberConnection("https://proxy.example.com", "工作台", "studio-pc");
    await renderScreen();

    // Both doors are listed with their own control, so one can go alone.
    const lan = container.querySelector('[aria-label="移除 局域网 · http://192.168.5.3:57074"]');
    const cloud = container.querySelector('[aria-label="移除 反代 · https://proxy.example.com"]');
    expect(lan).toBeTruthy();
    expect(cloud).toBeTruthy();
    // The computer's own row carries no ×: there is nothing to forget there
    // without choosing a door. The drag key lives on the group wrapper now, so
    // the row is what sits under it without the door class.
    const group = container.querySelector('.saved-group[data-drag-key="machine:studio-pc"]');
    expect(group).toBeTruthy();
    expect(group?.querySelector(".setting.saved-row:not(.door) .saved-forget")).toBeNull();
  });

  it("keeps the other address when one door of a computer is removed", async () => {
    rememberConnection("http://192.168.5.3:57074", "工作台", "studio-pc");
    rememberConnection("https://proxy.example.com", "工作台", "studio-pc");
    await renderScreen();

    act(() => {
      (
        container.querySelector(
          '[aria-label="移除 局域网 · http://192.168.5.3:57074"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(container.textContent).toContain("移除这个地址？");
    await press("移除");

    // The cloud door survives, and it is still the same computer.
    expect(container.textContent).toContain("反代 · https://proxy.example.com");
    expect(container.textContent).not.toContain("192.168.5.3:57074");
    expect(disconnectProxy).not.toHaveBeenCalled();
  });

  
  
  
});

describe("ConnectScreen hero", () => {
  it("shows the link machine's stage", async () => {
    await renderScreen(undefined, {
      link: {
        ...idleLink,
        phase: "connecting",
        step: "verify",
        completed: ["probe", "switch"],
      },
    });

    expect(container.querySelector(".link-hero-sub")?.textContent).toBe("正在读取会话…");
    expect(container.querySelectorAll(".link-steps li")).toHaveLength(3);
  });

  
});

describe("ConnectScreen background", () => {
  it("reports the two system permissions and opens their pages", async () => {
    vi.mocked(loadBackgroundStatus).mockResolvedValue({ exempt: false, notifications: true });
    await renderScreen();
    await press("偏好");

    expect(container.textContent).toContain("后台运行");
    expect(container.textContent).toContain("已开启");
    expect(container.textContent).toContain("受限");

    await pressRow("通知", "已开启");
    await pressRow("电池优化", "受限");

    expect(openNotificationSettings).toHaveBeenCalledTimes(1);
    expect(openBatterySettings).toHaveBeenCalledTimes(1);
  });

  it("hides the group when the native side cannot answer", async () => {
    await renderScreen();
    expect(container.textContent).not.toContain("后台运行");
  });
});

describe("ConnectScreen verification", () => {
  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("does not call a dead LAN address connected", async () => {
    vi.mocked(probeUpstream).mockResolvedValue({ ok: false, code: "client.offline" });
    await renderScreen();

    await press("连接这台电脑");
    await settle();

    expect(onConnected).not.toHaveBeenCalled();
    expect(container.textContent).toContain("读不到会话");
  });

  
  it("tells the app that a switched address could not be verified", async () => {
    const onFailed = vi.fn();
    vi.mocked(probeUpstream).mockResolvedValue({ ok: false, code: "client.offline" });
    await renderScreen(undefined, { onFailed });

    await press("连接这台电脑");
    await settle();

    expect(onFailed).toHaveBeenCalledWith(
      expect.objectContaining({ code: "client.offline", retryable: true }),
    );
  });

  it("connects when the kernel answers after the switch", async () => {
    await renderScreen();
    await press("连接这台电脑");
    await settle();
    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});
