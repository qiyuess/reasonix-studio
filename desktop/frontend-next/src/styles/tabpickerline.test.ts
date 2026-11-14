import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sheet = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const workbench = sheet("../design/workbench.css");
const shell = sheet("../design/shell.css");

const block = (css: string, pattern: RegExp, what: string) => {
  const found = css.match(pattern);
  expect(found, `no rule for ${what}; this test matches nothing`).not.toBeNull();
  return found![1];
};
const px = (css: string, prop: string, what: string) => {
  const found = css.match(new RegExp(`(?:^|[;{\\s])${prop}:\\s*(-?[\\d.]+)px`));
  expect(found, `${what}: no ${prop}`).not.toBeNull();
  return Number(found![1]);
};

// The row of controls at the head of the strip reads as one line or as none.
// The file tree is a 34px tab standing on the strip's bottom border and the tab
// picker beside it is a 28px square; laid out by their own centres they came
// apart by half the difference — 3.5px in the full-width strip, where the row
// is 42px tall, and barely at all in the window bar's 35px slot, which is why it
// went unnoticed until the workbench was expanded. They share one edge, and the
// smaller one carries the half difference as a margin so the two glyphs sit on
// the same line in both homes.
it("puts the tab picker on the file tree's line, in both of the strip's homes", () => {
  const picker = block(workbench, /\n\.workbench-tabs > \.workbench-picker\s*\{([^}]*)\}/, ".workbench-picker");
  // Three rules name this button: the order, the box, and the inline-flex that
  // holds its count. The one that matters here is the box.
  const files = block(workbench, /\.workbench-tabs > \.workbench-files\[data-action="workbench\.files"\]\s*\{([^}]*height[^}]*)\}/, ".workbench-files");

  // One edge for both: the full-width strip lays its controls out bottom-aligned,
  // and the bar slot centres the row, so the picker has to say `flex-end` itself.
  expect(px(files, "height", ".workbench-files")).toBe(34);
  expect(px(picker, "height", ".workbench-picker")).toBe(28);
  expect(files, "the file tree stands on the strip's edge").toMatch(/align-self:\s*flex-end/);
  expect(picker, "so does the picker").toMatch(/align-self:\s*flex-end/);

  // The half difference, spelled out of the two heights rather than as 3px, so
  // that resizing either button moves the compensation with it.
  expect(picker).toMatch(/margin-bottom:\s*calc\(\(\s*34px\s*-\s*28px\s*\)\s*\/\s*2\s*\)/);
});

it("keeps the same edge where the strip is portalled onto the window bar", () => {
  // The bar slot centres its children, so a picker that only says `flex-end` in
  // its own rule would be re-centred here and come off the line again.
  expect(shell).toMatch(/\.chrome \.wb-dock-head \.workbench-picker\s*\{[^}]*align-self:\s*flex-end/);
});
