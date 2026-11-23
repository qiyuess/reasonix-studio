// The size a page in the workbench is laid out in, and how much of the panel
// that page takes once it is drawn. A page framed at 393 pixels answers a
// phone's media queries because it is really 393 pixels wide — the scale only
// decides how much room the whole frame takes, never how wide the page thinks
// it is.

export interface Size {
  width: number;
  height: number;
}

/** How the frame fills the room around it. `fit` shrinks to fit and never
 *  blows up, so a phone-sized page in a wide window stays phone-sized; the
 *  percentages draw the frame at that fraction of its own size regardless of
 *  the room. */
export type FitMode = "fit" | "50" | "75" | "100";

/** The scales the row offers, in the order they read. */
export const SCALES: { id: FitMode; key: string }[] = [
  { id: "fit", key: "workbench.size_fit" },
  { id: "50", key: "workbench.size_50" },
  { id: "75", key: "workbench.size_75" },
  { id: "100", key: "workbench.size_100" },
];

/** The preset a size was last chosen from; `CUSTOM` once a side is typed. */
export const CUSTOM = "custom";

/** The frame a page the shell draws itself starts in: the panel's own, with the
 *  page laid out in the rectangle it was given rather than in a viewport of its
 *  own. A page framed this way is the size of the room, as it always was. */
export const PANEL = "panel";

export interface Preset extends Size {
  id: string;
  /** The message its row is labelled with. */
  key: string;
  /** The device a frame this size stands for: what a page sniffs for before
   *  it answers. `mobile` is the layout mode the CDP override carries;
   *  `dpr` is the glass the page is told it sits behind — 0 keeps whatever
   *  the view itself has; a UA is what a phone-shaped viewport alone never
   *  gave, so a page that sniffs for it still answered with its desktop
   *  self until one was said. */
  mobile: boolean;
  dpr: number;
  /** The UA the device stands for, built on the Chromium this app itself
   *  runs; null means "say nothing", which is the desktop the page would
   *  answer on its own. */
  ua: (chrome: string) => string | null;
}

// The three a person reaches for: a phone held upright, a tablet, and a
// laptop. Sizes are the CSS pixels each one reports, not its glass. A UA is
// the one a page sniffs for: same-engine wordings from the Chromium this app
// itself runs, so a page asked "which am I" answers with its mobile self
// instead of its desktop one. A UA sent is one the page keeps until the next
// one is said — leaving it unsaid keeps it, which is what a person changing
// only the numbers wants.
const ua = (mobile: boolean, platform: string) => (chrome: string) =>
  chrome
    ? mobile
      ? `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Mobile Safari/537.36`
      : `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
    : null;

export const PRESETS: Preset[] = [
  { id: "phone", width: 393, height: 852, key: "workbench.size_phone", mobile: true, dpr: 0, ua: ua(true, "Linux; Android 14") },
  { id: "tablet", width: 768, height: 1024, key: "workbench.size_tablet", mobile: true, dpr: 0, ua: ua(true, "Linux; Android 14; Tablet") },
  { id: "laptop", width: 1280, height: 800, key: "workbench.size_laptop", mobile: false, dpr: 0, ua: ua(false, "Windows NT 10.0; Win64; x64") },
];

/** The device semantics a frame carries when it was chosen from a preset:
 *  what a page sniffs for (a UA) and the layout mode and glass it reports
 *  (mobile and dpr). Custom numbers and the panel's own size carry none — a
 *  size somebody typed is a size, not a device somebody stood in front of
 *  the page. */
export interface Device {
  mobile: boolean;
  dpr: number;
  ua: string | null;
}

export interface Chosen extends Size {
  mode: FitMode;
  /** Whether the page is laid out in a viewport of its own. False means the
   *  panel's rectangle — the page is as wide as the room, as it always was —
   *  which is where a page the shell draws starts. Absent reads as framed,
   *  since a page this panel frames itself is always framed. */
  framed?: boolean;
  /** The device the frame stands for, when it was chosen from a preset and
   *  the shell can say one to the page. Absent means none. */
  device?: Device | null;
}

// A side narrower than this cannot hold the panel's own chrome, and one wider
// than this is a page nobody framed on purpose.
const MIN_SIDE = 240;
const MAX_SIDE = 3840;
const STORE = "rx-browser-size";

// The row opens on the phone: its size is what a fresh workbench frames at,
// and its device is what the page then answers as — the row says 手机 from
// the first open, and the page saying otherwise would be the row lying.
export const DEFAULT_SIZE: Chosen = { width: PRESETS[0].width, height: PRESETS[0].height, mode: "fit", device: deviceOf(PRESETS[0]) };

/** deviceOf is the device a preset stands for, its UA built on the Chromium
 *  this app itself runs — the same engine the page would answer on anyway, so
 *  the only thing that changes is which self it answers with. */
export function deviceOf(preset: Preset): Device {
  const chrome = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "";
  return { mobile: preset.mobile, dpr: preset.dpr, ua: preset.ua(chrome) };
}

/** clampSide keeps a typed or pasted number inside what this panel can draw. */
export function clampSide(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIZE.width;
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(value)));
}

/** presetOf names the preset a size matches, or `CUSTOM` for one it does not.
 *  A size that is not laid out in a viewport of its own matches `PANEL`: the
 *  page is the size of the room, whatever numbers were last typed. */
export function presetOf(size: Size & { framed?: boolean }): string {
  if (size.framed === false) return PANEL;
  return PRESETS.find((one) => one.width === size.width && one.height === size.height)?.id ?? CUSTOM;
}

/** fitScale is how much of the room the frame takes: the same answer the shell
 *  gives a native view (`placement` in browserviews.js), so a page framed here
 *  and an agent's page framed there look like the same thing. */
export function fitScale(room: Size, page: Size): number {
  if (!(room.width > 0) || !(room.height > 0)) return 1;
  if (!(page.width > 0) || !(page.height > 0)) return 1;
  return Math.min(1, room.width / page.width, room.height / page.height);
}

/** scaleOf answers the factor for a mode, so the drawing code never reads the
 *  mode itself. */
export function scaleOf(mode: FitMode, room: Size, page: Size): number {
  // A percentage is read as itself; only `fit` consults the room.
  if (mode === "fit") return fitScale(room, page);
  return Number(mode) / 100;
}

function read(raw: string | null): Chosen {
  if (!raw) return DEFAULT_SIZE;
  try {
    const one = JSON.parse(raw) as Partial<Chosen>;
    const width = clampSide(Number(one.width));
    const height = clampSide(Number(one.height));
    // Whether a page is framed is each panel's own first word — the panel this
    // app frames always is, a page the shell draws itself is not — so it is
    // never remembered here and never leaks from one to the other.
    const chosen: Chosen = { width, height, mode: SCALES.some((scale) => scale.id === one.mode) ? (one.mode as FitMode) : "fit" };
    // A device is remembered, though: a window reopened answers the page the
    // way the person left it — phone self and all, not its desktop one.
    const device = one.device;
    if (device && typeof device === "object") {
      chosen.device = {
        mobile: device.mobile === true,
        dpr: Number.isFinite(Number(device.dpr)) ? Math.max(0, Number(device.dpr)) : 0,
        ua: typeof device.ua === "string" && device.ua ? device.ua : null,
      };
    }
    return chosen;
  } catch {
    return DEFAULT_SIZE;
  }
}

/** loadSize is the size this window last drew a page in. A value that will not
 *  parse is the default rather than a failure: a page still has to be framed. */
export function loadSize(): Chosen {
  try {
    return read(localStorage.getItem(STORE));
  } catch {
    return DEFAULT_SIZE;
  }
}

export function saveSize(chosen: Chosen): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(chosen));
  } catch {
    // A window that cannot write keeps the choice for as long as it is open.
  }
}
