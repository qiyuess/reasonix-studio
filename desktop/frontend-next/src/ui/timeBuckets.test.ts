import { describe, expect, it } from "vitest";
import { monthBuckets } from "./timeBuckets";

const DAY = 86400_000;
// Sections are counted in calendar days from the day the list is drawn, so the
// fixtures are offsets from the real clock rather than a frozen date: a frozen
// one would drift out of its own section as soon as the suite ran later.
const NOW = Date.now();
const daysAgo = (days: number) => NOW - days * DAY;

const labelsOf = (rows: { key: string; at: number }[]) => [...monthBuckets(rows).marks.values()];

describe("the time reading's sections", () => {
  it("cuts every age onto the section it belongs to", () => {
    const rows = [
      { key: "today", at: daysAgo(0) },
      { key: "yesterday", at: daysAgo(1) },
      { key: "week", at: daysAgo(7) },
      { key: "month", at: daysAgo(30) },
      { key: "earlier", at: daysAgo(31) },
    ];
    expect([...monthBuckets(rows).marks.entries()]).toEqual([
      ["today", "今天"],
      ["yesterday", "昨天"],
      ["week", "7 天内"],
      ["month", "30 天内"],
      ["earlier", "更早"],
    ]);
  });

  it("counts calendar days, not 24-hour spans", () => {
    // Two calendar days back, whatever the hour: still inside the week section,
    // and never in today's.
    const marks = monthBuckets([{ key: "twoDays", at: daysAgo(2) }]).marks;
    expect([...marks.values()]).toEqual(["7 天内"]);
  });

  it("opens one section per run of rows, not one per row", () => {
    const marks = monthBuckets([
      { key: "a", at: daysAgo(0) },
      { key: "b", at: daysAgo(0) },
      { key: "c", at: daysAgo(2) },
    ]).marks;
    expect([...marks.keys()]).toEqual(["a", "c"]);
  });

  it("orders by recency itself, so a caller need not pre-sort", () => {
    // Deliberately out of order: the oldest row first.
    const marks = monthBuckets([
      { key: "old", at: daysAgo(40) },
      { key: "new", at: daysAgo(0) },
    ]).marks;
    expect([...marks.keys()]).toEqual(["new", "old"]);
  });

  it("reads a row with no stamp, or a zero one, as being written now", () => {
    expect(labelsOf([{ key: "unwritten", at: 0 }])).toEqual(["今天"]);
    expect(labelsOf([{ key: "blank", at: Number.NaN }])).toEqual(["今天"]);
  });

  it("skips a section no row falls into", () => {
    const marks = monthBuckets([
      { key: "today", at: daysAgo(0) },
      { key: "earlier", at: daysAgo(90) },
    ]).marks;
    expect([...marks.values()]).toEqual(["今天", "更早"]);
  });
});
