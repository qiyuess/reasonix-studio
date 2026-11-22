// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUSTOM, DEFAULT_SIZE, PANEL, clampSide, fitScale, loadSize, presetOf, saveSize, scaleOf } from "./browserSize";

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
  it("names the preset a size matches", () => {
    expect(presetOf({ width: 393, height: 852 })).toBe("phone");
    expect(presetOf({ width: 768, height: 1024 })).toBe("tablet");
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

describe("loadSize", () => {
  it("reads back what was saved", () => {
    saveSize({ width: 500, height: 900, mode: "100" });
    expect(loadSize()).toEqual({ width: 500, height: 900, mode: "100" });
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
