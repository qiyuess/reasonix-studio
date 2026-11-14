import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sheet = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = sheet("./app.css");
const shell = sheet("../design/shell.css");

/** The properties of one rule block, as written. */
function block(css: string, pattern: RegExp, what: string): string {
  const found = css.match(pattern);
  expect(found, `no rule for ${what}; this test matches nothing`).not.toBeNull();
  return found![1];
}
const px = (css: string, prop: string, what: string) => {
  const found = css.match(new RegExp(`(?:^|[;{\\s])${prop}:\\s*(-?[\\d.]+)px`));
  expect(found, `${what}: no ${prop}`).not.toBeNull();
  return Number(found![1]);
};

// The docked strip stops in front of the shell's own window controls, so
// `--winctl-w` is what they take off the bar's right end. It is written as the
// sum of the controls' own parts — three 44px targets, the margin in front of
// them, a -12px margin behind, the row's gap, the bar's right padding — because
// a bare length is what let this drift: the strip sat under the close button and
// nothing said so. Each part is read by name here, and read from the rule that
// actually paints it, so moving one moves the reservation with it.
describe("the window-controls reservation matches the controls it reserves for", () => {
  it("counts every part of the controls, and nothing twice", () => {
    const target = block(app, /\n\s*\.winctl \.wc\s*\{([^}]*)\}/, ".winctl .wc");
    const reserved = block(shell, /\n\.chrome:has\(> \.winctl\)\s*\{([^}]*)\}/, ".chrome:has(> .winctl)");
    const bar = block(shell, /\n\.chrome\s*\{([^}]*)\}/, ".chrome");

    // Named parts, so a change to any of them is a change to the sum.
    const lead = px(bar, "--winctl-lead", ".chrome");
    const gap = px(bar, "--chrome-gap", ".chrome");
    const pad = px(bar, "--chrome-pad-r", ".chrome");
    expect(px(target, "width", ".winctl .wc")).toBe(44);
    expect(reserved, "the sum is written out of its parts").toMatch(/--winctl-w:\s*calc\(/);
    expect(reserved, "the row's gap is counted").toContain("var(--chrome-gap)");
    expect(reserved, "the controls' own margin is counted").toContain("var(--winctl-lead)");
    expect(reserved, "the bar's padding is counted").toContain("var(--chrome-pad-r)");
    expect(reserved, "three targets, not two or four").toContain("3 * 44px");
    // The controls hang off the bar's padding by their own negative margin; it
    // is inside the sum as a subtraction, so it appears once.
    expect(reserved).toContain("- 12px");

    // The three terms the rule names must be the values the controls use: the
    // `.winctl` rule and the bar's gap have to be the same two lengths.
    expect(block(app, /\n\s*\.winctl\s*\{([^}]*)\}/, ".winctl"), "the controls' own margin").toContain("margin-left: var(--winctl-lead)");
    expect(bar, "the bar's gap").toContain("gap: var(--chrome-gap)");
    expect(lead + gap + pad + 3 * 44 - 12).toBe(146);
  });

  it("reserves the bare padding where the shell draws no controls", () => {
    // macOS and Linux draw their own frames, so the bar reaches back only by its
    // own padding — the same `--chrome-pad-r` the sum above ends with.
    const whole = block(shell, /\n\.chrome\s*\{([^}]*)\}/, ".chrome");
    expect(whole).toMatch(/--winctl-w:\s*var\(--chrome-pad-r\)/);
  });

  it("keeps the strip's own padding clear of the controls, from the same parts", () => {
    // The slot's children stop where the controls become visible. The bar's
    // padding and gap are counted inside `--winctl-w` but do not sit between the
    // slot's right edge and the controls, so the same two names come back out
    // here — the numbers are never written down twice.
    const slot = block(app, /\.chrome \.wb-dock-head:not\(:empty\)\s*\{([^}]*)\}/, ".wb-dock-head");
    const pad = slot.match(/padding-right:\s*([^;]+);/);
    expect(pad, "no padding-right on the slot").not.toBeNull();
    expect(pad![1]).toContain("var(--winctl-w)");
    expect(pad![1]).toContain("- var(--chrome-gap)");
    expect(pad![1]).toContain("- var(--winctl-lead)");
    // A shell with no controls leaves the variable at the bar's 12px padding,
    // which is less than the two terms taken off: the max() is what keeps it a
    // padding rather than a negative one.
    expect(pad![1].trim()).toMatch(/^max\(\s*6px/);
  });

  it("levels the controls above the slot that spans the bar's right end", () => {
    // The docked slot is absolutely positioned across that end. Without a
    // stacking context of their own the controls take presses under it: the
    // close button becomes drag-the-window.
    expect(app).toMatch(/\.chrome > \.winctl\s*\{[^}]*position:\s*relative[^}]*z-index:\s*\d/);
  });
});
