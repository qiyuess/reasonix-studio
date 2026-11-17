import { expect, it } from "vitest";

const CSS = import.meta.glob(["./app.css"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const css = CSS["./app.css"];

// React renders aria-selected={false} as the string "false" rather than leaving
// the attribute off, so [aria-selected] matches both tabs and paints the raised
// surface under the unselected one as well. The pair then reads as one block and
// the door on screen is whichever the reader guesses. Only "true" may be raised.
it("raises only the tab that names the door on screen", () => {
  const rule = css.match(/\.pc-tabs > button\[aria-selected="true"\]\s*\{([^}]*)\}/)?.[1];
  expect(rule).toBeDefined();
  expect(rule).toMatch(/background:\s*var\(--raised\)/);
});

it("leaves no pc-tabs rule keyed on the bare attribute", () => {
  expect(css.match(/\.pc-tabs > button\[aria-selected\](?!\s*=)/)).toBeNull();
});

// The strip answers the arrow keys, so a focused tab has to be visible. Every
// other focusable control in this file carries the same outline; a strip that
// moves focus without showing it is a keyboard trap the eye cannot follow.
it("shows where focus is on the pairing tabs", () => {
  expect(css).toMatch(/\.pc-tabs > button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
});
