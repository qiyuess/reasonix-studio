/**
 * The first screen on a phone: point the app at a kernel.
 *
 * A QR code carries either a LAN origin with a one-time pairing code, or the
 * Internet link. The pairing is spent by the loopback proxy, so the app never
 * puts the code in a URL and the device cookie lands on the app's own origin.
 * Account sign-in uses the device flow: a short code approved in the phone's
 * browser, with the session token kept by the proxy.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { onNetworkChange } from "../native/networkWatch";
import { Browser } from "@capacitor/browser";
import { Clipboard } from "@capacitor/clipboard";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import {
  configureProxy,
  parseServerLink,
  probeUpstream,
  readMachineIdentity,
  readProxyConfig,
  ProxyError,
} from "../net/server";
import type { ProxyConfig, ServerLink } from "../net/server";
import { disconnectProxy, setNetworkPolicy, studioWebUrl } from "../net/server";
import { linkFailure } from "../net/link";
import type { LinkError, LinkState } from "../net/link";
import { ConnectionHero } from "./ConnectionHero";
import { useBackCloser } from "./backStack";
import {
  connectionKey,
  directDoorForMachine,
  forgetConnection,
  groupConnections,
  isRemoteOrigin,
  learnConnectionMachine,
  loadConnections,
  moveConnectionGroup,
  normalizeTarget,
  rememberConnection,
} from "../net/savedConnections";
import type { ConnectionGroup, SavedConnection } from "../net/savedConnections";
import { dragShift, dropEdge, useRowDrag } from "./useRowDrag";
import { withTimeout } from "../net/http";
import { forgetFleetPeer } from "../net/fleet";
import { NativePair } from "../native/pair";
import type { PairResult } from "../native/pair";
import { openStudio } from "./openStudio";
import {
  loadBackgroundStatus,
  openBatterySettings,
  openNotificationSettings,
} from "../native/turn";
import type { BackgroundStatus } from "../native/turn";
import { THEME_CHOICES, applyTheme, loadTheme, saveTheme } from "./theme";
import { UI_STYLE_CHOICES, applyUiStyle, loadUiStyle, saveUiStyle } from "./uiStyle";
import {
  DISPATCH_AFTER_CHOICES,
  loadDispatchAfter,
  saveDispatchAfter,
} from "./dispatchPref";
import type { DispatchAfter } from "./dispatchPref";
import type { UiStyle } from "./uiStyle";
import type { ThemeChoice } from "./theme";
import { hapticSample, loadSurfaceChoice, loadHaptics, saveHapticSurface, saveHaptics } from "./haptics";
import { Switch } from "./Switch";
import { FOLD_CHOICES, loadFoldMode, saveFoldMode } from "../chat/folding";
import type { FoldMode } from "../chat/folding";
import { CHAT_FONT_CHOICES, applyChatFont, loadChatFont, saveChatFont } from "../chat/chatFont";
import type { ChatFont } from "../chat/chatFont";
import { NET_POLICY_CHOICES, loadNetPolicy, saveNetPolicy } from "./netpref";
import type { NetPolicy } from "./netpref";
import { loadRetainTranscript, saveRetainTranscript } from "./retainPref";
import { loadAutoHandover, saveAutoHandover } from "./handoverPref";
import { cacheStats, clearAllCachedRows } from "../chat/transcriptCache";
import type { CacheStats } from "../chat/transcriptCache";
import { ENTER_CHOICES, loadEnterPref, saveEnterPref } from "./enterPref";
import type { EnterPref } from "./enterPref";
import { Segmented } from "./Segmented";
import type { NotificationPrefs } from "./notifyPref";
import { useUpdater } from "./useUpdater";
import { UpdateRow } from "./UpdateRow";
import { STUDIO_MIN_CHROME, chromeMajor, needsStudioUpgrade } from "./webviewCompat";

export interface ConnectScreenProps {
  onConnected: () => void;
  /** The upstream was switched but the kernel did not answer through it. */
  onFailed?: (error: LinkError) => void;
  /** The person disconnected on purpose; the link machine stands down. */
  onDisconnected?: () => void;
  /** Present when this screen was opened over an existing connection. */
  onClose?: () => void;
  /** The app's link machine, for the hero at the top of the page. */
  link?: LinkState;
  /** Inline ask options in the notification; off means one 去回答 action. */
  notificationOptions?: boolean;
  onNotificationOptionsChange?: (on: boolean) => void;
  /** Which notification surfaces post, and whether ask interrupts. */
  notifyPrefs?: NotificationPrefs;
  onNotifyPrefChange?: (name: keyof NotificationPrefs, on: boolean) => void;
  /** The About page's copy-diagnostics text, built by App from its live state. */
  buildDiagnostics?: () => Promise<string>;
}

/** The settings panes, in swipe order. */
const PANE_OPTIONS = [
  { value: "connect", label: "连接" },
  { value: "prefs", label: "偏好" },
] as const;

/**
 * How long to wait for the hidden pairing page.
 *
 * `PairActivity` gives up at 15 s, so this only has to clear that with room
 * for the round trip back through the plugin. It exists because the activity's
 * answer is not guaranteed to arrive at all: the callback that carries it holds
 * a `PluginCall`, and a rebuilt activity or a reloaded WebView leaves that call
 * dead — the plugin then returns without settling and the promise never
 * resolves. Without a deadline of its own the screen would spin forever.
 */
const PAIR_DEADLINE_MS = 20_000;

type Pane = (typeof PANE_OPTIONS)[number]["value"];

/** A typed refusal is an identity; only an unknown error has no code. */
function refusalCode(failure: unknown): string {
  if (failure instanceof ProxyError) return failure.code;
  return failure instanceof Error ? failure.message : "unknown";
}

/** A size a person can read, not a byte count. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ConnectScreen({ onConnected, onFailed, onDisconnected, onClose, link, notificationOptions, onNotificationOptionsChange, notifyPrefs, onNotifyPrefChange, buildDiagnostics }: ConnectScreenProps) {
  const [config, setConfig] = useState<ProxyConfig | null>(null);
  const [origin, setOrigin] = useState("");
  const [pairCode, setPairCode] = useState("");
  /**
   * The launch token a self-hosted relay asks for, when this door is not a
   * neighbour. Held only long enough to hand to the proxy, which keeps it per
   * origin; the field is cleared once the door opens.
   */
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [theme, setThemeState] = useState<ThemeChoice>(() => loadTheme());
  const [uiStyle, setUiStyleState] = useState<UiStyle>(() => loadUiStyle());
  const [dispatchAfter, setDispatchAfterState] = useState<DispatchAfter>(() => loadDispatchAfter());
  const [fold, setFold] = useState<FoldMode>(() => loadFoldMode());
  /** The transcript's reading text size; applied to the root like the theme. */
  const [chatFont, setChatFont] = useState<ChatFont>(() => loadChatFont());
  /** Which half of settings is showing: the computer, or this phone. */
  const [pane, setPane] = useState<Pane>("connect");
  /** The About row: check for a release while the phone's preferences are open. */
  const updater = useUpdater(pane === "prefs");
  /** The direction the pane arrived from, so the slide reads as movement. */
  const [paneDir, setPaneDir] = useState<"none" | "forward" | "back">("none");
  /** How the proxy reaches a LAN computer while a VPN is active. */
  const [netPolicy, setNetPolicyState] = useState<NetPolicy>(() => loadNetPolicy());
  /** What Enter does in the composer: send, or a line break for hardware keyboards. */
  const [enterPref, setEnterPrefState] = useState<EnterPref>(() => loadEnterPref());
  /** Whether held rows, picked-up projects and streamed answers buzz. */
  const [haptics, setHapticsState] = useState(() => loadHaptics());
  /** Gesture feedback: a long press arming, a row being picked up and dropped. */
  const [hapticDrag, setHapticDragState] = useState(() => loadSurfaceChoice("drag"));
  /** Stream feedback: the two edges of an answer, not the text between them. */
  const [hapticStream, setHapticStreamState] = useState(() => loadSurfaceChoice("stream"));
  /** Whether a live link may move to the neighbour address of the same computer. */
  const [autoHandover, setAutoHandoverState] = useState(() => loadAutoHandover());
  /** Whether conversation content may stay on the phone between launches. */
  const [retainTranscript, setRetainState] = useState(() => loadRetainTranscript());
  /** What the transcript cache holds; null when IndexedDB cannot answer. */
  const [storage, setStorage] = useState<CacheStats | null | "loading">("loading");
  const [clearing, setClearing] = useState(false);
  /** The last clear's outcome, shown in place of the numbers until it reloads. */
  const [storageNote, setStorageNote] = useState("");
  /** The copy-diagnostics row's last result. */
  const [diagStatus, setDiagStatus] = useState("");
  /** Computers this phone has connected to before, newest first. */
  const [saved, setSaved] = useState<SavedConnection[]>(() => loadConnections());
  /** What the system allows in the background; null where it cannot answer. */
  const [background, setBackground] = useState<BackgroundStatus | null>(null);
  /** The saved door whose × was tapped; removal waits for this sheet. */
  const [forgetAsk, setForgetAsk] = useState<{
    row: SavedConnection;
    name: string;
    detail: string;
    door: boolean;
  } | null>(null);
  /** What a manual attempt is aiming at, before the proxy has switched. */
  const [pending, setPending] = useState<{ target: string } | null>(null);
  /** The scroll container; switching panes starts at the top, not mid-page. */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const choosePane = useCallback(
    (next: Pane) => {
      if (next === pane) return;
      const from = PANE_OPTIONS.findIndex((option) => option.value === pane);
      const to = PANE_OPTIONS.findIndex((option) => option.value === next);
      // Reset before the new pane paints, so the slide starts at its top.
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      setPaneDir(to > from ? "forward" : "back");
      setPane(next);
    },
    [pane],
  );

  useEffect(() => {
    let cancelled = false;
    void readProxyConfig().then((next) => {
      if (cancelled || next === null) return;
      setConfig(next);
      setOrigin(next.origin);
      // A connection made before this list existed, or by recovery, is still
      // a place worth returning to.
      if (next.origin) setSaved(rememberConnection(next.origin));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A LAN door is saved before the far side has said its name. Ask each one
  // once, so a cloud device and its LAN origin can be drawn as one computer.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    const unknown = loadConnections().filter(
      (entry) => entry.kind === "lan" && !entry.machine,
    );
    if (unknown.length === 0) return;
    void Promise.all(
      unknown.map(async (entry) => ({
        target: entry.target,
        identity: await readMachineIdentity(entry.target),
      })),
    ).then((answers) => {
      if (cancelled) return;
      let learned = false;
      for (const answer of answers) {
        if (!answer.identity) continue;
        learnConnectionMachine(answer.target, answer.identity.machine);
        learned = true;
      }
      if (learned) setSaved(loadConnections());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshBackground = useCallback(() => {
    void loadBackgroundStatus().then((next) => {
      if (next !== null) setBackground(next);
    });
  }, []);

  useEffect(() => {
    refreshBackground();
  }, [refreshBackground]);

  // The two rows below open system pages, so their values go stale while the
  // app is paused; rereading on resume is what makes the return trip honest.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;
    void NativeApp.addListener("appStateChange", (state) => {
      if (state.isActive) refreshBackground();
    }).then((handle) => {
      if (cancelled) {
        void handle.remove();
        return;
      }
      remove = () => {
        void handle.remove();
      };
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [refreshBackground]);

  const pickTheme = useCallback((choice: ThemeChoice) => {
    setThemeState(choice);
    saveTheme(choice);
    applyTheme(choice);
  }, []);

  const pickUiStyle = useCallback((style: UiStyle) => {
    setUiStyleState(style);
    saveUiStyle(style);
    applyUiStyle(style);
  }, []);

  const pickDispatchAfter = useCallback((after: DispatchAfter) => {
    setDispatchAfterState(after);
    saveDispatchAfter(after);
  }, []);

  const pickFold = useCallback((mode: FoldMode) => {
    setFold(mode);
    saveFoldMode(mode);
  }, []);

  const pickChatFont = useCallback((font: ChatFont) => {
    setChatFont(font);
    saveChatFont(font);
    applyChatFont(font);
  }, []);

  const pickNetPolicy = useCallback((policy: NetPolicy) => {
    setNetPolicyState(policy);
    saveNetPolicy(policy);
    // The proxy is the enforcer; the local store only remembers the choice.
    // An old native build has no route for this and the tap still sticks.
    void setNetworkPolicy(policy).catch(() => {});
  }, []);

  const pickEnterPref = useCallback((pref: EnterPref) => {
    setEnterPrefState(pref);
    saveEnterPref(pref);
  }, []);

  const pickHaptics = useCallback((enabled: boolean) => {
    setHapticsState(enabled);
    saveHaptics(enabled);
    // Turning it on is the one moment a sample is useful: it proves the
    // switch reached the device. It bypasses the per-surface switches, or
    // turning on a master whose sub-switches are all off would look broken.
    if (enabled) void hapticSample();
  }, []);

  const pickHapticDrag = useCallback((enabled: boolean) => {
    setHapticDragState(enabled);
    saveHapticSurface("drag", enabled);
  }, []);

  const pickHapticStream = useCallback((enabled: boolean) => {
    setHapticStreamState(enabled);
    saveHapticSurface("stream", enabled);
  }, []);

  /**
   * The person's answer about moving between a computer's doors.
   *
   * Written immediately rather than on leaving the screen: the next automatic
   * attempt reads it, and a switch flipped back before the screen closes must
   * not leave a stale value behind.
   */
  const pickAutoHandover = useCallback((enabled: boolean) => {
    setAutoHandoverState(enabled);
    saveAutoHandover(enabled);
  }, []);

  /**
   * Read the cache's size when the preferences pane opens.
   *
   * IndexedDB answers asynchronously and may refuse entirely. A zero that
   * really meant "unavailable" would read as "nothing cached", so the two are
   * kept apart all the way to the row.
   */
  useEffect(() => {
    if (pane !== "prefs") return;
    let cancelled = false;
    setStorage("loading");
    setStorageNote("");
    void cacheStats().then((stats) => {
      if (!cancelled) setStorage(stats);
    });
    return () => {
      cancelled = true;
    };
  }, [pane]);

  const pickRetainTranscript = useCallback((on: boolean) => {
    setRetainState(on);
    // Persist before clearing: the sweep below is asynchronous, and a write
    // that lands in between must already see retention off.
    saveRetainTranscript(on);
    if (!on) {
      setStorage({ entries: 0, rows: 0, bytes: 0 });
      setStorageNote("");
      void clearAllCachedRows();
    }
  }, []);

  const clearTranscripts = useCallback(async () => {
    setClearing(true);
    try {
      const result = await clearAllCachedRows();
      setStorage({ entries: 0, rows: 0, bytes: 0 });
      setStorageNote(
        result.entries > 0
          ? `已清理 ${result.entries} 段${retainTranscript ? "；当前打开的会话会在下次更新时重新缓存" : ""}`
          : "没有可清理的会话缓存",
      );
    } finally {
      setClearing(false);
    }
  }, [retainTranscript]);

  const connect = useCallback(
    async (target: string, code: string, launchToken?: string) => {
      const base = target.trim().replace(/\/+$/, "");
      const pairCodeValue = code.trim();
      const tokenValue = (launchToken ?? "").trim();
      if (!base) {
        setError("先填一个地址，或者扫码。");
        return;
      }
      const viaWeb = Capacitor.isNativePlatform() && pairCodeValue !== "";
      setBusy(viaWeb ? "正在配对" : "正在连接");
      setError("");
      setPending({ target: base });
      const previous = config;
      /** Put the working LAN upstream back when the new one cannot be read. */
      const restore = async (attempted: ProxyConfig): Promise<boolean> => {
        if (previous === null || !previous.origin) return false;
        if (normalizeTarget(previous.origin) === normalizeTarget(attempted.origin)) return false;
        try {
          const back = await configureProxy(previous.origin);
          setConfig(back);
          setOrigin(back.origin);
          // Switching back is not proof the old computer still answers; only
          // then may the link machine stay out of its failed state.
          return (await probeUpstream()).ok;
        } catch {
          // The old address remains a hint; the attempt's error is what to show.
          return false;
        }
      };
      const apply = async (next: ProxyConfig): Promise<boolean> => {
        setConfig(next);
        setOrigin(next.origin);
        // The proxy now has an address; that is not the same as a kernel.
        // Read the conversation list before calling this a connection, so a
        // dead address is refused here instead of on the home screen.
        setBusy("正在读取会话");
        const reach = await probeUpstream();
        if (!reach.ok) {
          const failure = linkFailure(reach.code);
          // A restored upstream is still a live link; only an attempt that
          // left the phone nowhere belongs in the link machine's failed state.
          if (!(await restore(next))) onFailed?.(failure);
          setError(
            `连上了地址，但读不到会话：${failure.message}` +
              (previous?.vpn ? " 检测到 VPN/代理，可在「连接」页改代理策略。" : ""),
          );
          return false;
        }
        setPairCode("");
        // The proxy keeps the token per origin from here on; leaving it in the
        // field would show a secret on a screen that no longer needs it.
        setToken("");
        if (next.origin) setSaved(rememberConnection(next.origin));
        onConnected();
        return true;
      };
      try {
        if (viaWeb) {
          let outcome: PairResult = { paired: false, reason: "unavailable" };
          try {
            // The Studio page's own #pair bootstrap is the path a browser
            // uses; the hidden WebView runs it and leaves its cookie for the
            // proxy. The direct POST /pair below is only the fallback.
            //
            // The deadline is the shell's, not the page's: `PairActivity`
            // gives up after 15 s, but its result only reaches us if the
            // plugin's callback still holds a live `PluginCall`. When the
            // activity is rebuilt or the WebView reloads, that call is gone
            // and the plugin returns without settling — so without a deadline
            // here the promise never resolves, `connect`'s `finally` never
            // runs, and the button sits on "正在配对" forever. Timing out is
            // not a failure: the cookie may already have landed, which is why
            // the exchange below still runs.
            //
            // A result that arrives after the deadline is dropped, not
            // adopted: `withTimeout` has already settled the race by then, and
            // the activity that would have produced it has been abandoned.
            // Nothing is lost in practice — the page's own timeout is five
            // seconds shorter, so a late answer only means the callback died.
            outcome = await withTimeout(
              NativePair.pair({
                url: `${base}/#pair=${encodeURIComponent(pairCodeValue)}`,
                origin: base,
              }),
              PAIR_DEADLINE_MS,
            );
          } catch {
            // The activity did not answer; the exchange below can still pair.
          }
          if (outcome.paired) {
            await apply(await configureProxy(base));
            return;
          }
          if (outcome.reason === "cancelled") {
            // Closing the sheet is a choice, not a failed pairing.
            setError("");
            return;
          }
          // The hidden page can fail without spending the code: an older
          // share page has no #pair bootstrap, and a slow cookie is not a
          // refusal. Let the exchange itself decide.
          try {
            if (await apply(await configureProxy(base, pairCodeValue))) return;
            return;
          } catch (failure) {
            // A code the page already spent answers 403. Its cookie may
            // still have landed, in which case the kernel can answer.
            if (refusalCode(failure) === "device.pairing_invalid") {
              try {
                if (await apply(await configureProxy(base))) return;
              } catch {
                // Report the refusal below; it names the next step.
              }
            }
            throw failure;
          }
        }
        // A relay door authenticates by token; a neighbour by pair code. Only
        // name the token when one was typed, so the two shapes stay distinct.
        await apply(
          await (tokenValue
            ? configureProxy(base, pairCodeValue || undefined, tokenValue)
            : configureProxy(base, pairCodeValue || undefined)),
        );
      } catch (failure) {
        const failureCode = refusalCode(failure);
        const where = base;
        if (failureCode === "device.pairing_invalid") {
          setError(
            `配对码已失效（地址 ${where}，App 用的码 ${pairCodeValue || "(空)"}）。` +
              "请在电脑上点「换一个」生成新码后重新扫码；在浏览器里打开过的码已经用完。",
          );
          // A refused code cannot answer a retry; asking again needs a new one.
          setPairCode("");
        } else if (failureCode === "device.pair_route_missing") {
          setError(`这个地址不是局域网配对端口（${where}）。请用二维码里的地址，不要手填 8791。`);
          setPairCode("");
        } else if (failureCode === "device.pair_unreachable" || failureCode === "proxy.upstream_unreachable") {
          // A network failure does not spend the code; keep it for the retry.
          setError(
            "到不了这台电脑：确认在同一 Wi-Fi、电脑上的 Studio 正在运行，并允许它通过防火墙。" +
              (previous?.vpn ? " 检测到 VPN/代理，可在「连接」页改代理策略。" : ""),
          );
        } else {
          setError(`没连上：${failureCode}`);
        }
      } finally {
        setBusy("");
        setPending(null);
      }
    },
    [config, onConnected, onFailed],
  );

  const applyLink = useCallback(
    async (serverLink: ServerLink) => {
      setOrigin(serverLink.origin);
      setPairCode(serverLink.pairCode ?? "");
      setToken(serverLink.token ?? "");
      await connect(serverLink.origin, serverLink.pairCode ?? "", serverLink.token ?? "");
    },
    [connect],
  );

  const scan = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setError("扫码只在 Android 应用里可用；浏览器里请填地址。");
      return;
    }
    setBusy("正在打开相机");
    setError("");
    try {
      const result = await CapacitorBarcodeScanner.scanBarcode({
        // A Studio code is always a QR code. Asking for every symbology makes
        // the detector do needless work per frame and is the main reason the
        // first read felt slow; MLKit's QR-only path is the fast one.
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: "对准二维码，慢的话点手电筒",
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
        android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.MLKIT },
      });
      const scanned = parseServerLink(result.ScanResult);
      if (!scanned) {
        setError("这个二维码里没有连接信息。");
        return;
      }
      await applyLink(scanned);
    } catch (failure) {
      setError(failure instanceof Error ? `扫码没完成：${failure.message}` : "扫码没完成");
    } finally {
      setBusy("");
    }
  }, [applyLink]);

  const pasteLink = useCallback(async () => {
    setError("");
    try {
      const { value } = await Clipboard.read();
      const pasted = parseServerLink(value);
      if (!pasted) {
        setError("剪贴板里没有连接链接。请复制浏览器地址栏里的完整 URL。");
        return;
      }
      await applyLink(pasted);
    } catch (failure) {
      setError(failure instanceof Error ? `读取剪贴板失败：${failure.message}` : "读取剪贴板失败");
    }
  }, [applyLink]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;
    void NativeApp.addListener("appUrlOpen", (event) => {
      const opened = parseServerLink(event.url);
      if (opened) void applyLink(opened);
    }).then((handle) => {
      if (cancelled) {
        void handle.remove();
        return;
      }
      remove = () => {
        void handle.remove();
      };
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [applyLink]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;
    void onNetworkChange((status) => {
      if (!status.connected) return;
      // Read, do not refresh: `/refresh` probes the remembered origins and
      // may re-point the proxy at another computer. Choosing a door belongs to
      // the link machine, which verifies it and updates the target; this screen
      // only keeps its copy of the ordered candidates current.
      void readProxyConfig().then((next) => {
        if (next === null) return;
        setConfig(next);
        setOrigin(next.origin);
      });
    }).then((handle) => {
      if (cancelled) {
        void handle?.remove();
        return;
      }
      remove = () => {
        void handle?.remove();
      };
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  /**
   * Drop the active upstream without touching the saved rows: the phone goes
   * offline by choice, and reconnecting is a tap on a remembered computer.
   */
  /**
   * Drop the active upstream without touching the saved rows: the phone goes
   * offline by choice, and reconnecting is a tap on a remembered computer.
   *
   * The proxy is asked first. Tearing the web-side relay down before the
   * POST answers would kill a live connection on a failure — an old shell
   * that does not know the route — and the native proxy would keep
   * forwarding without anyone being told.
   */
  const disconnect = useCallback(async () => {
    setError("");
    try {
      const next = await disconnectProxy();
      setOrigin("");
      setConfig(next);
      onDisconnected?.();
    } catch (failure) {
      setError(`没断开：${refusalCode(failure)}`);
    }
  }, [onDisconnected]);

  /**
   * Forget one door: this address, not the whole computer.
   *
   * A computer can hold several doors — a LAN origin and a cloud id, or two
   * addresses on different subnets — and they are not interchangeable: one may
   * be a stale port while the other still answers. Removing the computer
   * because one address went bad is how a working route gets lost.
   *
   * The side effects belong to the door being removed: the cloud identity is
   * what a reinstall has to clear, and the fleet watch is spent per target.
   */
  const forgetDoor = useCallback((row: SavedConnection) => {
    void forgetFleetPeer(row.target).catch(() => {});
    setSaved(forgetConnection(row.target));
  }, []);

  /**
   * Switch to a recorded computer: the pairing the proxy already holds is
   * reused, so no code is asked for again.
   */
  const switchTo = useCallback(
    async (entry: SavedConnection) => {
      if (busy) return;
      await connect(entry.target, "");
    },
    [busy, connect],
  );

  const current = useCallback(
    (entry: SavedConnection): boolean =>
      config !== null && normalizeTarget(config.origin) === entry.target,
    [config],
  );

  /**
   * Remove the door the sheet names, and only then.
   *
   * The × is a destructive control sitting next to a row whose main tap
   * switches computers, so a mis-touch must not unrecord a working route.
   */
  const settleForget = useCallback(
    (confirmed: boolean) => {
      const ask = forgetAsk;
      setForgetAsk(null);
      if (!ask || !confirmed) return;
      const wasHere = current(ask.row);
      forgetDoor(ask.row);
      if (wasHere) void disconnect();
    },
    [current, disconnect, forgetAsk, forgetDoor],
  );
  // The forget sheet sits on the back stack like the trust one: back cancels
  // it instead of closing the whole settings screen under it.
  useBackCloser(forgetAsk !== null, () => settleForget(false));

  const known = config?.origin ?? "";
  /**
   * The addresses this phone can reach without going through a tunnel.
   *
   * A computer exposing both its Wi-Fi address and a mesh-VPN one is two rows
   * in the list above, and they are not equally good. Naming the direct one
   * is what lets a person pick it on purpose instead of by experiment.
   */
  const direct = config?.direct ?? [];
  const labelOf = (entry: SavedConnection): string => entry.name;
  const currentEntry = saved.find((entry) => current(entry)) ?? null;

  /** One row per computer: two addresses that named the same machine. */
  const groups = groupConnections(saved);
  const groupHere = (group: ConnectionGroup): boolean => group.rows.some(current);
  /** The door a tap takes: direct LAN, then LAN, then cloud, then the rest. */
  const groupDoor = (group: ConnectionGroup): SavedConnection => {
    const here = group.rows.find(current);
    if (here) return here;
    const near = group.machine
      ? directDoorForMachine(group.rows, group.machine, direct)
      : null;
    if (near) return near;
    return group.rows[0]!;
  };
  const groupLabel = (group: ConnectionGroup, door: SavedConnection): string =>
    group.machine || labelOf(door);
  /**
   * One door, named so two doors of one computer can be told apart.
   *
   * The group's own detail line summarises the whole computer ("局域网 · 云端"),
   * which is right for the row a tap takes. Under it, each door has to say
   * which route it is and where it points, or the × beside it would be a guess.
   */
  const doorDetail = (door: SavedConnection): string => {
    // A reverse proxy is an HTTPS origin, so it lands in the same door as a
    // neighbour. Saying "局域网" for an address on the internet would promise a
    // direct route this phone can never take.
    if (isRemoteOrigin(door.target)) return "反代 · 自己的地址";
    const near = direct.some((candidate) => normalizeTarget(candidate) === door.target);
    // The door's title is already its address; repeating the URL here wrapped
    // "可直连" in half on a phone.
    return near ? "局域网 · 可直连" : "局域网";
  };
  /** The × label keeps the address even when the visible line does not. */
  const doorAria = (door: SavedConnection): string =>
    `${isRemoteOrigin(door.target) ? "反代" : "局域网"} · ${door.target}`;
  /** A door's own name, for the row under a computer. */
  const doorLabel = (door: SavedConnection): string => labelOf(door);
  const groupDetail = (group: ConnectionGroup, door: SavedConnection): string => {
    const transport = `${isRemoteOrigin(door.target) ? "反代" : "局域网"} · ${door.target}`;
    const near = group.rows.some((row) =>
      direct.some((candidate) => normalizeTarget(candidate) === row.target),
    );
    return near ? `${transport} · 可直连` : transport;
  };

  /**
   * The saved list is also the retry order, so it is rearranged here as well
   * as in 切换连接. Both write the same record; whichever is open shows the
   * order the next reconnect will walk. One computer moves as a block: its
   * two doors must stay together or the next walk could split them.
   */
  const savedDrag = useRowDrag<HTMLElement>({
    rows: groups.map((group) => ({
      key: group.key,
      movable: true,
    })),
    enabled: busy === "" && pane === "connect",
    scrollerSelector: ".connect",
    place: (key, index) => setSaved(moveConnectionGroup(key, index)),
  });
  const spare = config ? config.candidates.length - 1 : 0;
  const connectedGroup = groups.find(groupHere);
  const connectedName =
    connectedGroup?.machine
      ?? currentEntry?.machine
      ?? currentEntry?.name
      ?? (known ? "电脑" : "连接你的电脑");
  const route = known ? (isRemoteOrigin(known) ? "反代" : "局域网") : "";
  const connectedDetail = known
    ? (spare > 0 ? `${route} · 还有 ${spare} 个备用地址` : route === "反代" ? "反代" : "局域网直连")
    : "扫码或粘贴配对链接";
  const heroName = pending?.target ?? connectedName;
  const heroDetail =
    pending === null
      ? connectedDetail
      : isRemoteOrigin(pending.target)
        ? "反代"
        : "局域网";
  /** The computer's own Studio page, for opening the full desktop UI. */
  const webUrl = studioWebUrl(config);
  /**
   * The in-app page runs on the phone's own WebView, which may be years
   * behind: nothing in the app can update it, and the Studio front end needs
   * Chrome 111 for its colours and 105 for its layout. Say so on the row
   * instead of opening a page that looks broken — the browser below is the
   * way out for that phone, since browsers carry their own engine.
   */
  const webViewMajor = chromeMajor(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
  const studioNeedsUpgrade = needsStudioUpgrade(webViewMajor);
  const openWebUrl = () => {
    setError("");
    // The page follows the route the link machine has, not the origin the
    // proxy still remembers: a phone that left Wi-Fi keeps a LAN address.
    void openStudio().then((result) => {
      if (result.kind === "none") setError("读不到这台电脑的 Studio 地址。");
      else if (result.kind === "failed") setError("打不开完整界面。");
    });
  };

  const storageText =
    storage === "loading"
      ? "统计中…"
      : storage === null
        ? "统计不可用"
        : `${storage.entries} 段 · ${storage.rows.toLocaleString()} 行 · 约 ${formatBytes(storage.bytes)}`;

  return (
    <div className="connect" ref={scrollRef}>
      <div className="settings-bar">
        <header className="settings-head">
          {onClose ? (
            <button type="button" className="iconbtn" onClick={onClose} aria-label="返回">
              ←
            </button>
          ) : (
            <span className="bar-spacer" />
          )}
          <div className="settings-title">
            <h1>设置</h1>
          </div>
          {onClose ? (
            <button type="button" className="linkbtn" onClick={onClose}>
              完成
            </button>
          ) : (
            <span className="bar-spacer" />
          )}
        </header>

        <Segmented
          className="settings-tabs"
          ariaLabel="设置页面"
          value={pane}
          options={PANE_OPTIONS}
          onChange={choosePane}
        />
      </div>

      <div className="connect-body" data-dir={paneDir} key={pane}>
        {/* The computer this phone is pointed at and what the link is doing:
            the one fact every control below is judged against, so it leads. */}
        {pane === "connect" ? (
          <ConnectionHero name={heroName} detail={heroDetail} link={link} busy={busy} onRepair={scan} />
        ) : null}

        {/* How this phone reaches the computer: which network is live, and
            whether the proxy detours a VPN for LAN targets. The states the
            old VPN note repeated in three places are drawn here once. */}
        {pane === "connect" ? (
          <>
            <p className="group-label">网络</p>
            <section className="group">
              <div className="setting">
                <span className="setting-main">
                  <span className="setting-title">当前连接</span>
                  <span className="setting-sub">
                    {config?.origin ? `局域网 · ${config.origin}` : "未连接"}
                  </span>
                </span>
                <span className="setting-value">
                  {config?.vpn ? "VPN 下" : config?.lan ? "Wi‑Fi/以太网" : "移动网络"}
                </span>
              </div>
              <div className="setting">
                <span className="setting-main">
                  <span className="setting-title">代理策略</span>
                  <Segmented
                    ariaLabel="代理策略"
                    value={netPolicy}
                    options={NET_POLICY_CHOICES}
                    onChange={pickNetPolicy}
                  />
                </span>
              </div>
            </section>
          </>
        ) : null}

        {pane === "connect" && webUrl ? (
          <>
            <p className="group-label">完整界面</p>
            <section className="group">
              <button
                type="button"
                className="setting action"
                onClick={() => openWebUrl()}
                disabled={busy !== ""}
              >
                <span className="setting-main">
                  <span className="setting-title">在应用内打开</span>
                  <span className="setting-sub">
                    {studioNeedsUpgrade
                      ? `系统 WebView 是 Chrome ${webViewMajor}，页面会显示不全`
                      : "电脑上那套 Studio 页面，整页运行在这里"}
                  </span>
                </span>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>
              <button
                type="button"
                className="setting action"
                onClick={() => {
                  setError("");
                  void Browser.open({ url: webUrl }).catch(() => setError("打不开浏览器。"));
                }}
                disabled={busy !== ""}
              >
                <span className="setting-main">
                  <span className="setting-title">在浏览器打开</span>
                  <span className="setting-sub">
                    {studioNeedsUpgrade
                      ? "同一个页面，交给系统浏览器（自带内核，显示正常）"
                      : "同一个页面，交给系统浏览器"}
                  </span>
                </span>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>
            </section>
            {studioNeedsUpgrade ? (
              <p className="group-note">
                电脑上那套页面用到 Chrome {STUDIO_MIN_CHROME} 才支持的写法，手机系统 WebView
                还停在 {webViewMajor}。去应用商店更新「Android 系统 WebView」后重启 App
                即可恢复；更新不了就先在上面用浏览器打开。
              </p>
            ) : null}
          </>
        ) : null}

        {/* Places this phone has already connected to. The current one is
            marked; the rest are one tap away, with a way to forget a computer
            that moved or a device that left the account. */}
        {pane === "connect" && saved.length > 0 ? (
          <>
            <p className="group-label">已连接的电脑</p>
            <section
              className="group"
              ref={savedDrag.listRef}
              data-dragging={savedDrag.state ? "true" : undefined}
            >
              {groups.map((group, index) => {
                const door = groupDoor(group);
                const label = groupLabel(group, door);
                const here = groupHere(group);
                const shift = dragShift(savedDrag.state, index);
                // One computer can hold several doors — a LAN origin and a
                // cloud id, or two addresses of the same machine. The row taps
                // the best one; the doors under it are what a person can
                // forget one at a time.
                const many = group.rows.length > 1;
                return (
                  // The drag key sits on the wrapper, not the row inside it: a
                  // computer with doors is taller than its top row, and the
                  // drop indicator places itself from these boxes. Keying the
                  // inner row would leave the doors out of the height, so the
                  // indicator would land short and the ghost would trail.
                  <div
                    key={group.key}
                    className={`saved-group${savedDrag.state?.key === group.key ? " dragging" : ""}`}
                    data-drag-key={group.key}
                    data-drop={dropEdge(savedDrag.state, index, groups.length)}
                    style={shift === 0 ? undefined : { transform: `translateY(${shift}px)` }}
                    {...savedDrag.row(group.key)}
                  >
                    <div className="setting saved-row">
                      <button
                        type="button"
                        className="saved-main"
                        disabled={busy !== ""}
                        aria-current={here ? "true" : undefined}
                        onClick={() => void switchTo(door)}
                      >
                        <span className="setting-main">
                          <span className="setting-title">
                            {label}
                            {here ? <span className="saved-current">当前</span> : null}
                          </span>
                          <span className="setting-sub">{groupDetail(group, door)}</span>
                        </span>
                        <span className="chev" aria-hidden="true">
                          ›
                        </span>
                      </button>
                      {/* A single-door computer keeps its × on the row: there is
                          nothing to choose between, and a disclosure triangle
                          that opens one item is a step for no information. */}
                      {many ? null : (
                        <button
                          type="button"
                          className="saved-forget"
                          aria-label={`移除 ${label}`}
                          onClick={() =>
                            setForgetAsk({
                              row: door,
                              name: label,
                              detail: groupDetail(group, door),
                              door: false,
                            })
                          }
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {many
                      ? group.rows.map((row) => {
                          const rowHere = current(row);
                          return (
                            <div className="setting saved-row door" key={connectionKey(row.target)}>
                              <span className="setting-main">
                                <span className="setting-title">
                                  {doorLabel(row)}
                                  {rowHere ? <span className="saved-current">当前</span> : null}
                                </span>
                                <span className="setting-sub">{doorDetail(row)}</span>
                              </span>
                              <button
                                type="button"
                                className="saved-forget"
                                aria-label={`移除 ${doorAria(row)}`}
                                onClick={() =>
                                  setForgetAsk({
                                    row,
                                    name: doorLabel(row),
                                    detail: doorDetail(row),
                                    door: true,
                                  })
                                }
                              >
                                ×
                              </button>
                            </div>
                          );
                        })
                      : null}
                  </div>
                );
              })}
            </section>
            {config?.origin ? (
              <button type="button" className="setting action danger" onClick={() => void disconnect()} disabled={busy !== ""}>
                断开连接
              </button>
            ) : null}
          </>
        ) : null}

        {pane === "connect" ? (
          <>
            <p className="group-label">连接新电脑</p>
            <section className="group">
              <button type="button" className="setting" onClick={() => void scan()} disabled={busy !== ""}>
            <span className="setting-main">
              <span className="setting-title">
                {busy === "正在打开相机" ? "正在打开相机…" : "扫码连接"}
              </span>
            </span>
            <span className="chev" aria-hidden="true">
              ›
            </span>
          </button>
          <button type="button" className="setting" onClick={() => void pasteLink()} disabled={busy !== ""}>
            <span className="setting-main">
              <span className="setting-title">粘贴链接</span>
            </span>
            <span className="chev" aria-hidden="true">
              ›
            </span>
          </button>
        </section>

        <details className="group manual-group">
          <summary className="setting manual-summary">
            <span className="setting-main">
              <span className="setting-title">手动填写地址</span>
            </span>
            <span className="chev" aria-hidden="true">
              ›
            </span>
          </summary>
          <label className="setting">
            <span className="setting-title">服务器地址</span>
            <input
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="http://192.168.5.2:8791"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label className="setting">
            <span className="setting-title">配对码</span>
            <input
              value={pairCode}
              onChange={(event) => setPairCode(event.target.value)}
              placeholder="扫码后自动填写"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label className="setting">
            <span className="setting-title">启动令牌</span>
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="自建中继时填写，局域网留空"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              type="password"
            />
          </label>
          <p className="group-note">
            同一 Wi-Fi 直连用配对码；走自己的服务器时改填启动令牌，两者只填一个。
          </p>
          <button
            type="button"
            className="setting action"
            onClick={() => void connect(origin, pairCode, token)}
            disabled={busy !== "" || !origin.trim()}
          >
            {busy === "正在连接" ? "正在连接…" : "连接这台电脑"}
          </button>
        </details>

        {busy && busy !== "正在连接" && busy !== "正在打开相机" ? (
          <p className="group-note">{busy}…</p>
        ) : null}

        {error ? (
          <div className="notice error">
            {error}
          </div>
        ) : null}

          </>
        ) : null}

        {pane === "prefs" ? (
          <>
        <p className="group-label">通用</p>
        <section className="group">
          <div className="setting">
            <span className="setting-title">主题</span>
            <Segmented
              ariaLabel="主题风格"
              value={uiStyle}
              options={UI_STYLE_CHOICES}
              onChange={pickUiStyle}
            />
          </div>
          <div className="setting">
            <span className="setting-title">明暗</span>
            <Segmented
              ariaLabel="明暗"
              value={theme}
              options={THEME_CHOICES}
              onChange={pickTheme}
            />
          </div>
          <div className="setting">
            <span className="setting-title">会话</span>
            <Segmented
              ariaLabel="会话详略"
              value={fold}
              options={FOLD_CHOICES}
              onChange={pickFold}
            />
          </div>
          <div className="setting">
            <span className="setting-title">会话字号</span>
            <Segmented
              ariaLabel="会话字号"
              value={chatFont}
              options={CHAT_FONT_CHOICES}
              onChange={pickChatFont}
            />
          </div>
          <div className="setting">
            <span className="setting-title">Enter 键</span>
            <Segmented
              ariaLabel="Enter 键行为"
              value={enterPref}
              options={ENTER_CHOICES}
              onChange={pickEnterPref}
            />
          </div>
          <div className="setting">
            <span className="setting-title">震动</span>
            <Switch checked={haptics} onChange={pickHaptics} ariaLabel="震动" />
          </div>
          {/* The two surfaces under the master switch. Off is off: a row here
              cannot re-enable feedback the master just silenced, so the rows
              are disabled rather than merely inert — a switch that moves and
              changes nothing is the worse lie. */}
          <div className="setting sub">
            <span className="setting-main">
              <span className="setting-title">拖拽与长按</span>
              <span className="setting-sub">长按呼出操作、拖动排序时震动</span>
            </span>
            <Switch
              checked={hapticDrag}
              onChange={pickHapticDrag}
              ariaLabel="拖拽与长按震动"
              disabled={!haptics}
            />
          </div>
          <div className="setting sub">
            <span className="setting-main">
              <span className="setting-title">回答开始与结束</span>
              <span className="setting-sub">只在开头和结尾震一次，生成过程中不震</span>
            </span>
            <Switch
              checked={hapticStream}
              onChange={pickHapticStream}
              ariaLabel="回答开始与结束震动"
              disabled={!haptics}
            />
          </div>
        </section>

        <p className="group-label">连接</p>
        <section className="group">
          <div className="setting">
            <span className="setting-main">
              <span className="setting-title">自动切换连接方式</span>
              <span className="setting-sub">
                同一台电脑有局域网地址和反代地址时，回到家自动改走直连；确认是另一台电脑时绝不自动切换
              </span>
            </span>
            <Switch
              checked={autoHandover}
              onChange={pickAutoHandover}
              ariaLabel="自动切换连接方式"
            />
          </div>
        </section>

        <p className="group-label">存储</p>
        <section className="group">
          <button
            type="button"
            className="setting"
            onClick={() => void clearTranscripts()}
            disabled={clearing}
          >
            <span className="setting-main">
              <span className="setting-title">会话缓存</span>
              <span className="setting-sub">{storageNote || storageText}</span>
            </span>
            <span className="setting-value">{clearing ? "清理中…" : "清理"}</span>
          </button>
          <div className="setting">
            <span className="setting-main">
              <span className="setting-title">保留会话内容</span>
              <span className="setting-sub">
                关闭后重开会话需要重新读取；对话原文与工具输出都会从这台手机删除，草稿和设置不受影响。
              </span>
            </span>
            <Switch
              checked={retainTranscript}
              onChange={pickRetainTranscript}
              ariaLabel="保留会话内容"
            />
          </div>
        </section>

        <p className="group-label">派发</p>
        <section className="group">
          <div className="setting">
            <span className="setting-title">派发后</span>
            <Segmented
              ariaLabel="派发后跳转"
              value={dispatchAfter}
              options={DISPATCH_AFTER_CHOICES}
              onChange={pickDispatchAfter}
            />
          </div>
        </section>

        {Capacitor.isNativePlatform() && onNotifyPrefChange ? (
          <>
            <p className="group-label">通知</p>
            <section className="group">
              {/*
                The people who most need these switches are the ones a
                permanent icon annoys, so the ongoing row leads and says what
                "off" actually does: the service keeps running, the icon goes.
                Calling it "关闭" would promise a teardown that cannot happen.
              */}
              <div className="setting">
                <span className="setting-main">
                  <span className="setting-title">常驻通知</span>
                  <span className="setting-sub">
                    关闭后不出现在状态栏，后台提醒仍然工作
                  </span>
                </span>
                <Switch
                  checked={notifyPrefs?.ongoing ?? false}
                  onChange={(on) => onNotifyPrefChange("ongoing", on)}
                  ariaLabel="常驻通知"
                />
              </div>
              <div className="setting sub">
                <span className="setting-main">
                  <span className="setting-title">需要你处理</span>
                  <span className="setting-sub">有提问、批准或恢复选择等你回答时提醒</span>
                </span>
                <Switch
                  checked={notifyPrefs?.ask ?? true}
                  onChange={(on) => onNotifyPrefChange("ask", on)}
                  ariaLabel="需要你处理的通知"
                />
              </div>
              <div className="setting sub">
                <span className="setting-main">
                  <span className="setting-title">弹窗提醒</span>
                  <span className="setting-sub">
                    关闭后只进通知栏，不弹出横幅
                  </span>
                </span>
                <Switch
                  checked={notifyPrefs?.headsUp ?? true}
                  onChange={(on) => onNotifyPrefChange("headsUp", on)}
                  ariaLabel="弹窗提醒"
                  disabled={!(notifyPrefs?.ask ?? true)}
                />
              </div>
              <div className="setting sub">
                <span className="setting-main">
                  <span className="setting-title">会话完成</span>
                  <span className="setting-sub">一轮跑完时提醒</span>
                </span>
                <Switch
                  checked={notifyPrefs?.done ?? true}
                  onChange={(on) => onNotifyPrefChange("done", on)}
                  ariaLabel="会话完成的通知"
                />
              </div>
              {onNotificationOptionsChange ? (
                <div className="setting sub">
                  <span className="setting-main">
                    <span className="setting-title">在通知里显示选项</span>
                    <span className="setting-sub">
                      关闭时只显示「去回答」，点击直接进入该会话
                    </span>
                  </span>
                  <Switch
                    checked={notificationOptions ?? false}
                    onChange={onNotificationOptionsChange}
                    ariaLabel="通知里显示选项"
                    disabled={!(notifyPrefs?.ask ?? true)}
                  />
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {background ? (
          <>
            <p className="group-label">后台运行</p>
            <section className="group">
              <button type="button" className="setting" onClick={openNotificationSettings}>
                <span className="setting-main">
                  <span className="setting-title">通知</span>
                </span>
                <span className="setting-value">
                  {background.notifications ? "已开启" : "已关闭"}
                </span>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>
              <button type="button" className="setting" onClick={openBatterySettings}>
                <span className="setting-main">
                  <span className="setting-title">电池优化</span>
                </span>
                <span className="setting-value">
                  {background.exempt ? "已允许" : "受限"}
                </span>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>
            </section>
          </>
        ) : null}

        <p className="group-label">关于</p>
        <section className="group">
          <div className="setting">
            <span className="setting-title">版本</span>
            <span className="setting-value">{__APP_VERSION__}</span>
          </div>
          {Capacitor.isNativePlatform() ? (
            <UpdateRow status={updater.status} onAction={updater.act} />
          ) : null}
          {buildDiagnostics ? (
            <button
              type="button"
              className="setting"
              onClick={() => {
                void (async () => {
                  try {
                    await Clipboard.write({ string: await buildDiagnostics() });
                    setDiagStatus("已复制");
                  } catch {
                    setDiagStatus("复制失败");
                  }
                })();
              }}
            >
              <span className="setting-main">
                <span className="setting-title">复制诊断信息</span>
                <span className="setting-sub">版本、网络、WebView 和最近错误；不含聊天内容</span>
              </span>
              <span className="setting-value">{diagStatus || "复制"}</span>
            </button>
          ) : null}
        </section>
          </>
        ) : null}

      </div>

      {forgetAsk ? (
        <div className="sheet-backdrop" role="presentation" onClick={() => settleForget(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forget-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-head">
              <h2 id="forget-title">{forgetAsk.door ? "移除这个地址？" : "移除这台电脑？"}</h2>
            </div>
            <p className="trust-device">{forgetAsk.name}</p>
            <p className="group-note">{forgetAsk.detail}</p>
            <p className="group-note">
              只删除手机上的连接记录；电脑上的 Studio、会话和账号都不受影响。以后再连需要重新配对。
            </p>
            <ul className="sheet-actions">
              <li>
                <button type="button" className="danger" onClick={() => settleForget(true)}>
                  移除
                </button>
              </li>
              <li>
                <button type="button" onClick={() => settleForget(false)}>
                  取消
                </button>
              </li>
            </ul>
          </div>
        </div>
      ) : null}

    </div>
  );
}
