// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUSTOM, DEFAULT_SIZE, PANEL, PRESETS, clampSide, deviceOf, fitScale, loadSize, presetOf, saveSize, scaleOf } from "./browserSize";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("fitScale", () => {
  it("shrinks a frame to fit the room around it", () => {
    expect(fitScale({ width: 400, height: 800 }, { width: 800, height: 800 })).toBe(0.5);
  });

  // A phone-sized page in a wide window stays phone-sized: the frame is a
  // viewport, and blowing it up would answer media queries no phone answers.
  it("never blows a frame up past its own size", () => {
    expect(fitScale({ width: 2000, height: 1600 }, { width: 393, height: 852 })).toBe(1);
  });

  it("takes the tighter of the two sides", () => {
    expect(fitScale({ width: 900, height: 400 }, { width: 600, height: 800 })).toBe(0.5);
  });

  // The first paint measures nothing: a scale of 0 would draw the page at no
  // size at all, so an unmeasured room means the frame is drawn as it is.
  it("answers one for a room that has not been measured yet", () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 393, height: 852 })).toBe(1);
  });

  it("follows the mode it is asked about", () => {
    const room = { width: 200, height: 200 };
    const page = { width: 400, height: 400 };
    expect(scaleOf("fit", room, page)).toBe(0.5);
    // A percentage is the fraction itself, whatever the room says.
    expect(scaleOf("100", room, page)).toBe(1);
    expect(scaleOf("50", room, page)).toBe(0.5);
  });
});

describe("clampSide", () => {
  it("keeps a side inside what the panel can draw", () => {
    expect(clampSide(10)).toBe(240);
    expect(clampSide(99999)).toBe(3840);
    expect(clampSide(393.4)).toBe(393);
  });

  it("falls back to the default width for a number that is not one", () => {
    expect(clampSide(Number.NaN)).toBe(DEFAULT_SIZE.width);
  });
});

describe("presetOf", () => {
  it("names the device a size matches", () => {
    expect(presetOf({ width: 375, height: 667 })).toBe("iphone-se");
    expect(presetOf({ width: 768, height: 1024 })).toBe("ipad-mini");
  });

  it("keeps a device's name when it is rotated", () => {
    // A rotated iPhone is the same device at the other orientation; the
    // stored preset is what carries the name when the numbers alone would
    // also match a different device.
    expect(presetOf({ width: 844, height: 390, preset: "iphone-12-pro" })).toBe("iphone-12-pro");
  });

  it("calls a size no preset matches custom", () => {
    expect(presetOf({ width: 500, height: 900 })).toBe(CUSTOM);
  });

  it("names the panel itself for a page laid out as the room", () => {
    // The row highlights the panel's own size whatever numbers were last
    // typed: they are not the page's size, the room is.
    expect(presetOf({ width: 500, height: 900, framed: false })).toBe(PANEL);
  });
});

describe("deviceOf", () => {
  it("builds an Android phone's UA on the Chromium this app itself runs", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36");
    const phone = deviceOf(PRESETS.find((one) => one.id === "pixel-7")!);
    expect(phone.mobile).toBe(true);
    expect(phone.dpr).toBe(2.625);
    // The engine is the app's own — only which self the page answers with
    // changes, never the engine it answers on.
    expect(phone.ua).toBe("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36");
  });

  it("answers an iPhone with the Safari wording DevTools sends", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("something without a chrome version");
    const iphone = deviceOf(PRESETS.find((one) => one.id === "iphone-12-pro")!);
    expect(iphone.ua).toContain("iPhone; CPU iPhone OS");
    expect(iphone.ua).toContain("Safari/604.1");
  });

  it("answers a desktop as a desktop, and no UA when the engine is not known", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36");
    const desktop = deviceOf(PRESETS.find((one) => one.id === "nest-hub-max")!);
    expect(desktop.mobile).toBe(false);
    expect(desktop.ua).toMatch(/Chrome\/[\d.]+ Safari/);
    expect(desktop.ua).not.toMatch(/Mobile/);
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("something without a chrome version");
    expect(deviceOf(PRESETS.find((one) => one.id === "pixel-7")!).ua).toBeNull();
  });
});

describe("loadSize", () => {
  it("reads back what was saved", () => {
    saveSize({ width: 500, height: 900, mode: "100" });
    expect(loadSize()).toEqual({ width: 500, height: 900, mode: "100" });
  });

  // The device outlives the window with the size it was chosen at: a page
  // opened later answers as the device the person left it standing on.
  it("remembers the device a frame was chosen from", () => {
    const device = { mobile: true, dpr: 0, ua: "Mozilla/5.0 (Linux; Android 14) Chrome/1 Mobile" };
    saveSize({ width: 393, height: 852, mode: "fit", device });
    expect(loadSize().device).toEqual(device);
  });

  it("drops a device that is not one rather than answering as a stranger", () => {
    localStorage.setItem("rx-browser-size", JSON.stringify({ width: 500, height: 900, mode: "fit", device: { mobile: "yes" } }));
    expect(loadSize().device?.mobile).toBe(false);
  });

  // A page still has to be framed, so a value that will not parse is the
  // default rather than a failure.
  it("falls back to the default for a value that will not parse", () => {
    localStorage.setItem("rx-browser-size", "{not json");
    expect(loadSize()).toEqual(DEFAULT_SIZE);
  });

  it("clamps a saved size that is out of range", () => {
    localStorage.setItem("rx-browser-size", JSON.stringify({ width: 5, height: 99999, mode: "fit" }));
    expect(loadSize()).toEqual({ width: 240, height: 3840, mode: "fit" });
  });
});
