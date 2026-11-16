import { createLucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { host } from "../port/host";

/** The three title-bar glyphs, drawn to one measure.
 *
 *  Lucide's own minus, square and x reach 14, 18 and 12 units of their 24-unit
 *  box, so inside one 16px frame they landed at 9.3, 12 and 8px — three sizes
 *  on a row of three, which is what made the box read as wrong rather than
 *  merely bigger. These keep every glyph inside the same 18-unit square, which
 *  is also what the bar's own icons reach: 16px × 18/24 = 12px, the same ink as
 *  the moon and the monitor beside them. */
const Minimise = createLucideIcon("WindowMinimise", [
  ["path", { d: "M3 12h18", key: "line" }],
]);
const Maximise = createLucideIcon("WindowMaximise", [
  ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "1.5", key: "box" }],
]);
// The window that is already zoomed shows the one behind it: a full box for the
// state it returns to, and two edges for the one it is in. Its two frames make
// it read slightly heavier than a single box, so it is drawn one unit in.
const Restore = createLucideIcon("WindowRestore", [
  ["rect", { x: "4", y: "9", width: "11", height: "11", rx: "1.5", key: "back" }],
  ["path", { d: "M8 4h11a1 1 0 0 1 1 1v11", key: "front" }],
]);
const Close = createLucideIcon("WindowClose", [
  ["path", { d: "M3 3l18 18", key: "down" }],
  ["path", { d: "M21 3L3 21", key: "up" }],
]);

// Where the chrome is standing in for the title bar. Linux keeps its own frame,
// and a browser tab has no window to zoom.
const isTitleBar = () => {
  const d = document.documentElement.dataset;
  return d.titlebar === "app" && (d.platform === "darwin" || d.platform === "windows");
};

// Double-clicking a title bar zooms the window on both platforms. The drag
// region is drawn by the webview, so nothing native is left to hear the click.
export function zoomOnTitleBar(e: { target: EventTarget | null }) {
  if (!isTitleBar()) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest("button, input, textarea, .picker, .menu")) return;
  host().toggleMaximiseWindow();
}

// Frameless Windows has no native minimise/maximise/close, so a shell that goes
// frameless without drawing these leaves a window that can only be closed from
// the keyboard. Rendered on Windows alone: macOS keeps its own lights and Linux
// its whole frame.
export function WindowControls() {
  const [max, setMax] = useState(false);
  // The window owns this state, so read it back rather than inferring it from
  // our own click: the button is one of several ways it changes, alongside a
  // double-click on the bar, a snap and the keyboard.
  useEffect(() => {
    const read = () => {
      void host().isWindowMaximised().then(setMax);
    };
    read();
    // The observer the layout already rides on, so it is the one proven to fire
    // in this shell when the window changes size.
    const ro = new ResizeObserver(read);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  if (document.documentElement.dataset.platform !== "windows") return null;
  return (
    <div className="winctl" role="group" aria-label={t("common.window")}>
      <button className="wc" data-action="window.minimize" onClick={() => host().minimiseWindow()} aria-label={t("app.minimize")}>
        <Minimise />
      </button>
      <button
        className="wc"
        data-action="window.maximize"
        onClick={() => host().toggleMaximiseWindow()}
        aria-label={t(max ? "app.restore" : "app.maximize")}
      >
        {max ? <Restore /> : <Maximise />}
      </button>
      <button className="wc close" data-action="window.close" onClick={() => host().closeWindow()} aria-label={t("common.close")}>
        <Close />
      </button>
    </div>
  );
}
