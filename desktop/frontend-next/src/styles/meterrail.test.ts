import { describe, expect, it } from "vitest";

const SHEET = Object.values(
  import.meta.glob("./studio.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)[0];

interface Rule {
  selector: string;
  decls: Map<string, string>;
}

function rules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const part of m[2].split(";")) {
      const at = part.indexOf(":");
      if (at > 0) decls.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
    }
    out.push({ selector: m[1].trim(), decls });
  }
  return out;
}

describe("status rail figures hold their width", () => {
  const rail = rules(SHEET).filter((r) => r.selector.split(",").some((s) => s.includes(".studio-meterrail")));

  it("finds the rail rules", () => {
    expect(rail.length).toBeGreaterThan(0);
  });

  it("keeps tabular numerals on every rule that sets the font shorthand", () => {
    const reset = rail
      .filter((r) => r.decls.has("font") && r.decls.get("font-variant-numeric") !== "tabular-nums")
      .map((r) => r.selector.replace(/\s+/g, " "));
    expect(reset, "the font shorthand resets font-variant-numeric; restate tabular-nums in the same rule").toEqual([]);
  });

  it("reserves the width of a three-digit speed so 9.9 to 10.0 and 99.9 to 100.0 do not move its neighbours", () => {
    const speed = rail.find((r) => r.selector === ".studio-meterrail .studio-meter-speed b");
    expect(speed?.decls.get("min-width")).toBe("5ch");
  });

  // The turn count grows on its own — 9 to 10, 99 to 100 — with the cost chips
  // right behind it, so it owes the same reservation the speed figure pays.
  it("reserves the width of the turn count, which grows on its own beside the cost", () => {
    const turns = rail.find((r) => r.selector === ".studio-meterrail .studio-meter-turns b");
    expect(turns?.decls.get("min-width")).toBe("3ch");
    expect(turns?.decls.get("text-align")).toBe("right");
  });

  // Its label is set faint like every other session figure's, so the number is
  // what the eye lands on. Scanned over the whole sheet on purpose: this rule
  // is grouped with the cache/cost/context labels, which are written without
  // the .studio-meterrail prefix, so the rail subset above cannot see it.
  it("sets the turn count's label to the same faint as the figures around it", () => {
    const faint = rules(SHEET)
      .filter((r) => r.selector.split(",").some((s) => s.trim() === ".studio-meter-turns > span"))
      .map((r) => r.decls.get("color"));
    expect(faint).toContain("var(--faint)");
  });
});
