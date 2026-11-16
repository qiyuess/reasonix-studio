import { describe, expect, it } from "vitest";
import css from "./turn.css?raw";

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
};

describe("the turn follows the boards", () => {
  it("puts the refusal at the left of a pending request and the grants at the right", () => {
    const deny = rule(".flow .call[data-approval] .apv-ft .btn[data-deny]");
    expect(deny).toMatch(/order:\s*-1/);
    expect(deny).toMatch(/margin-right:\s*auto/);
  });

  it("sets the turn's close across the line, the range at the left and the duration at the right", () => {
    const line = rule(".rc[data-worked]");
    expect(line).toMatch(/justify-content:\s*space-between/);
    // The duration keeps the right edge on its own: with no range to draw, the
    // line still ends where it always did.
    expect(rule(".rc[data-worked] .rc-ok")).toMatch(/margin-left:\s*auto/);
    expect(rule(".rc[data-worked] .rc-tick")).toMatch(/width:\s*14px/);
  });

  it("lets the range give up its width before the duration does, so a narrow window does not overflow", () => {
    const range = rule(".rc[data-worked] .rc-span");
    expect(range).toMatch(/min-width:\s*0/);
    expect(range).toMatch(/text-overflow:\s*ellipsis/);
    expect(range).toMatch(/white-space:\s*nowrap/);
    expect(rule(".rc[data-worked] .rc-ok")).toMatch(/white-space:\s*nowrap/);
  });

  it("paints a stuck, open activity heading in the conversation's own colour so rows scroll under it unseen", () => {
    expect(rule(".activity-group[open] > summary")).toMatch(/background:\s*var\(--surface\)/);
  });
});
