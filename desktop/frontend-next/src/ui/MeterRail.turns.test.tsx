// @vitest-environment jsdom
import "./testkit";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MeterRail } from "./MeterRail";

afterEach(cleanup);

function rail(authoredTurns?: number | null, extra: { cost?: boolean; tariff?: boolean } = {}) {
  return render(
    <MeterRail
      tps={0} trail={[]} running={false} speed={{ output: 0, modelSeconds: 0, average: 0, firstToken: 0 }}
      metrics={{ hit: 0, miss: 0 }} ctx={null} mcp={[]} compact={{ phase: "idle" } as never}
      cost={extra.cost ? [{ currency: "CNY", amount: 6 }] : []} wallet={{} as never}
      tariff={extra.tariff ? ({ peak: false, changesAt: "" } as never) : undefined}
      hideAmounts={false} tasks={[]} jobs={[]} onSettings={vi.fn()} onCancelJob={vi.fn(async () => {})}
      authoredTurns={authoredTurns as number | undefined}
    />,
  );
}

// The chip itself is the button inside its anchor: the anchor also carries the
// note the count opens, and only the button reads as the figure.
const chip = (c: HTMLElement) => c.querySelector<HTMLElement>(".studio-meter-turns");
// The figure alone: a loose text match lets "10" satisfy an assertion about "0",
// which is how a wrong count passes a test meant to catch it.
const figure = (c: HTMLElement) => chip(c)?.querySelector("b")?.textContent;

it("names the turns the person started, not the model's replies", () => {
  const { container } = rail(7);
  expect(chip(container)?.textContent).toMatch(/对话轮次/);
  expect(figure(container)).toBe("7");
});

it("reads zero as a known count, not missing data", () => {
  const { container } = rail(0);
  expect(chip(container)).not.toBeNull();
  expect(figure(container)).toBe("0");
});

// A kernel that predates the field arrives as absent, and a zero there would
// report a session nobody had started.
it("draws no count at all while the status has not answered", () => {
  const { container } = rail(undefined);
  expect(chip(container)).toBeNull();
});

// null and NaN are not counts either: the first would print the label with no
// figure behind it, the second would print "NaN" as a number.
it("draws no count for a value that is not a finite number", () => {
  for (const bad of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { container } = rail(bad as number | null);
    expect(chip(container), String(bad)).toBeNull();
    cleanup();
  }
});

// It sits among the session-level figures, after what the model did and before
// what the session has cost. The anchor is what the rail's own order sees: the
// button inside it is what a reader sees.
it("keeps its place between the tariff and the cost chips when they share the rail", () => {
  const { container } = rail(3, { cost: true, tariff: true });
  const order = [...container.querySelectorAll(".studio-meterrail > *")].map((e) =>
    typeof e.className === "string" ? e.className : "",
  );
  const at = (name: string) => order.findIndex((c) => c.includes(name));
  expect(at("studio-meter-tariff"), order.join(" | ")).toBeGreaterThanOrEqual(0);
  expect(at("studio-turns-anchor"), order.join(" | ")).toBeGreaterThan(at("studio-meter-tariff"));
  expect(at("studio-meter-cost"), order.join(" | ")).toBeGreaterThan(at("studio-turns-anchor"));
});
