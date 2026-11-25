// The size a page in the workbench is laid out in, and how much of the panel
// that page takes once it is drawn. A page framed at 412 pixels answers a
// phone's media queries because it is really 412 pixels wide — the scale only
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
  /** The device's name as the row and the picker show it. Device names are
   *  proper nouns, so they are not translated. */
  name: string;
  /** The device a frame this size stands for: what a page sniffs for before
   *  it answers. `mobile` is the layout mode the CDP override carries;
   *  `dpr` is the glass the page is told it sits behind — 0 keeps whatever
   *  the view itself has; a UA is what a phone-shaped viewport alone never
   *  gave, so a page that sniffs for it still answered with its desktop
   *  self until one was said. */
  mobile: boolean;
  dpr: number;
  /** The UA the device stands for, built on the Chromium this app itself
   *  runs for Android; iOS devices keep the Safari wording DevTools sends,
   *  because that is the self those pages sniff for. Null means "say
   *  nothing", which is the desktop the page would answer on its own. */
  ua: (chrome: string) => string | null;
}

// The device list Chrome's Device toolbar carries. Sizes are the CSS pixels
// each device reports, not its glass; DPR is the glass the page is told it
// sits behind. The order is the one the toolbar reads, with the foldables and
// smart displays after the phones and tablets.
const uaChrome = (platform: string, mobile: boolean) => (chrome: string) =>
  chrome ? `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}${mobile ? " Mobile" : ""} Safari/537.36` : null;
const uaAndroid = (model: string) => uaChrome(`Linux; Android 14; ${model}`, true);
const uaWindows = uaChrome("Windows NT 10.0; Win64; x64", false);
const uaLinux = uaChrome("X11; Linux x86_64", false);
const uaIOS = (device: "iPhone" | "iPad") => () => {
  const os = device === "iPad" ? "CPU OS 17_4 like Mac OS X" : "CPU iPhone OS 17_4 like Mac OS X";
  return `Mozilla/5.0 (${device}; ${os}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1`;
};

export const PRESETS: Preset[] = [
  { id: "iphone-se", name: "iPhone SE", width: 375, height: 667, mobile: true, dpr: 2, ua: uaIOS("iPhone") },
  { id: "iphone-xr", name: "iPhone XR", width: 414, height: 896, mobile: true, dpr: 2, ua: uaIOS("iPhone") },
  { id: "iphone-12-pro", name: "iPhone 12 Pro", width: 390, height: 844, mobile: true, dpr: 3, ua: uaIOS("iPhone") },
  { id: "iphone-14-pro-max", name: "iPhone 14 Pro Max", width: 430, height: 932, mobile: true, dpr: 3, ua: uaIOS("iPhone") },
  { id: "pixel-7", name: "Pixel 7", width: 412, height: 915, mobile: true, dpr: 2.625, ua: uaAndroid("Pixel 7") },
  { id: "galaxy-s8-plus", name: "Samsung Galaxy S8+", width: 360, height: 740, mobile: true, dpr: 4, ua: uaAndroid("SM-G955U") },
  { id: "galaxy-s20-ultra", name: "Samsung Galaxy S20 Ultra", width: 412, height: 915, mobile: true, dpr: 3.5, ua: uaAndroid("SM-G988B") },
  { id: "ipad-mini", name: "iPad Mini", width: 768, height: 1024, mobile: true, dpr: 2, ua: uaIOS("iPad") },
  { id: "ipad-air", name: "iPad Air", width: 820, height: 1180, mobile: true, dpr: 2, ua: uaIOS("iPad") },
  { id: "ipad-pro", name: "iPad Pro", width: 1024, height: 1366, mobile: true, dpr: 2, ua: uaIOS("iPad") },
  { id: "surface-pro-7", name: "Surface Pro 7", width: 912, height: 1368, mobile: true, dpr: 2, ua: uaWindows },
  { id: "surface-duo", name: "Surface Duo", width: 540, height: 720, mobile: true, dpr: 2.5, ua: uaAndroid("Surface Duo") },
  { id: "galaxy-z-fold-5", name: "Galaxy Z Fold 5", width: 344, height: 882, mobile: true, dpr: 3, ua: uaAndroid("SM-F946B") },
  { id: "zenbook-fold", name: "Asus Zenbook Fold", width: 1280, height: 852, mobile: false, dpr: 2, ua: uaWindows },
  { id: "galaxy-a51", name: "Samsung Galaxy A51/71", width: 412, height: 914, mobile: true, dpr: 2.625, ua: uaAndroid("SM-A515F") },
  { id: "nest-hub", name: "Nest Hub", width: 1024, height: 600, mobile: false, dpr: 1, ua: uaLinux },
  { id: "nest-hub-max", name: "Nest Hub Max", width: 1280, height: 800, mobile: false, dpr: 1, ua: uaLinux },
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
  /** The preset the frame was chosen from. It outlives a rotation, where the
   *  two sides swap and the size alone no longer names the device; two
   *  presets can also share a size, so the size is not the identity. */
  preset?: string;
}

// A side narrower than this cannot hold the panel's own chrome, and one wider
// than this is a page nobody framed on purpose.
const MIN_SIDE = 240;
const MAX_SIDE = 3840;
const STORE = "rx-browser-size";

// The row opens on the device DevTools' toolbar leaves selected: Samsung
// Galaxy A51/71. Its size is what a fresh workbench frames at, and its device
// is what the page then answers as — the row says that name from the first
// open, and the page saying otherwise would be the row lying.
const DEFAULT_PRESET = PRESETS.find((one) => one.id === "galaxy-a51") ?? PRESETS[0];
export const DEFAULT_SIZE: Chosen = {
  width: DEFAULT_PRESET.width,
  height: DEFAULT_PRESET.height,
  mode: "fit",
  device: deviceOf(DEFAULT_PRESET),
  preset: DEFAULT_PRESET.id,
};

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

/** presetOf names the device a frame was chosen from, `CUSTOM` for a size
 *  somebody typed, and `PANEL` for a page laid out as the room. The stored
 *  preset is the identity: two presets can share a size, and a size alone
 *  never says the page was given a device. */
export function presetOf(size: Size & { framed?: boolean; preset?: string }): string {
  if (size.framed === false) return PANEL;
  if (size.preset === CUSTOM) return CUSTOM;
  return PRESETS.some((one) => one.id === size.preset) ? size.preset! : CUSTOM;
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
    // A preset is remembered with the size, because a rotation or two devices
    // with one size cannot be told apart by the numbers alone. An id that is
    // no longer in the list is dropped rather than shown as a device.
    const preset = one.preset;
    const named = typeof preset === "string" && PRESETS.some((known) => known.id === preset);
    if (named || preset === CUSTOM) chosen.preset = preset;
    // A device rides with a named preset. A store from before presets were
    // recorded has one without a name; keeping it would let the row say
    // Responsive while the page still answers as a phone.
    const device = one.device;
    if (named && device && typeof device === "object") {
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
