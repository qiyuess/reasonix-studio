/** One row a sidebar list can order. `pinned` rows form the head partition;
 *  `rememberable` is false for a project the kernel has never stored, which
 *  always sits after the remembered ones. */
export type ReorderItem = { key: string; pinned: boolean; rememberable: boolean };

export type DropLine = { key: string; edge: "before" | "after" };

type Placement = {
  /** The project or session the kernel should land before; "" is the end. */
  before: string;
  /** Insertion index in the full manual list without the carried row. */
  previewAt: number;
  /** The visible row to paint the line on; null when the drop changes nothing. */
  line: DropLine | null;
};

/** The first row whose middle is below the pointer, or the end. */
export function slotAt(boxes: readonly { top: number; height: number }[], y: number): number {
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!;
    if (y < box.top + box.height / 2) return i;
  }
  return boxes.length;
}

/** The insertion index in the list without the carried row. */
export function insertionAt(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/** The slot range a carried row may name: its pinned block, or for a project
 *  the kernel never stored, the remembered unpinned block it would join. */
export function blockRange(items: readonly ReorderItem[], from: number): { start: number; end: number; inside: boolean } {
  const moved = items[from];
  if (!moved) return { start: 0, end: 0, inside: false };
  if (!moved.rememberable) {
    const start = items.findIndex((item) => !item.pinned && item.rememberable);
    const implicit = items.findIndex((item) => !item.rememberable);
    const end = implicit < 0 ? items.length : implicit;
    return { start: start < 0 ? end : start, end, inside: false };
  }
  let start = from;
  while (start > 0 && items[start - 1]!.rememberable && items[start - 1]!.pinned === moved.pinned) start--;
  let end = from + 1;
  while (end < items.length && items[end]!.rememberable && items[end]!.pinned === moved.pinned) end++;
  return { start, end, inside: true };
}

/** The pointer slot, clamped to the carried row's block. Null when the slot
 *  is where the row already sits: no painted line, no write. */
export function pointerInsertion(items: readonly ReorderItem[], from: number, slot: number): number | null {
  const { start, end, inside } = blockRange(items, from);
  const raw = insertionAt(from, slot);
  const at = Math.min(Math.max(raw, start), inside ? end - 1 : end);
  if (inside && at === from) return null;
  return at;
}

export function pinnedEnd(items: readonly ReorderItem[]): number {
  let end = 0;
  for (let i = 0; i < items.length; i++) if (items[i]!.pinned) end = i + 1;
  return end;
}

export function firstImplicit(items: readonly ReorderItem[]): number {
  return items.findIndex((item) => !item.rememberable);
}

/** Where an insertion in the visible list lands in the full manual list, and
 *  what the kernel should be told. An implicit row is never a kernel target:
 *  the drop means the end of the remembered order. */
export function placeAt(visible: readonly ReorderItem[], full: readonly ReorderItem[], fromKey: string, insertion: number): Placement {
  const fromVis = visible.findIndex((item) => item.key === fromKey);
  const fromFull = full.findIndex((item) => item.key === fromKey);
  const moved = full[fromFull];
  if (fromVis < 0 || !moved) return { before: "", previewAt: -1, line: null };
  if (moved.rememberable && insertion === fromVis) return { before: "", previewAt: -1, line: null };
  const withoutVisible = visible.filter((item) => item.key !== fromKey);
  const withoutFull = full.filter((item) => item.key !== fromKey);
  const target = insertion < withoutVisible.length ? withoutVisible[insertion] : null;
  const last = withoutVisible[withoutVisible.length - 1];
  const atFull = target
    ? withoutFull.findIndex((item) => item.key === target.key)
    : last ? withoutFull.findIndex((item) => item.key === last.key) + 1 : withoutFull.length;
  const next = withoutFull[atFull];
  const before = next && next.pinned === moved.pinned && next.rememberable ? next.key : "";
  let previewAt = atFull;
  if (before === "") {
    previewAt = moved.pinned ? pinnedEnd(withoutFull) : firstImplicit(withoutFull);
    if (previewAt < 0) previewAt = withoutFull.length;
  }
  return { before, previewAt, line: lineFor(moved, withoutVisible, before, target) };
}

function lineFor(moved: ReorderItem, withoutVisible: readonly ReorderItem[], before: string, target: ReorderItem | null): DropLine | null {
  if (before !== "") {
    if (target?.key === before) return { key: target.key, edge: "before" };
    const last = withoutVisible[withoutVisible.length - 1];
    return last ? { key: last.key, edge: "after" } : null;
  }
  if (moved.pinned) {
    const firstUnpinned = withoutVisible.find((item) => !item.pinned);
    if (firstUnpinned) return { key: firstUnpinned.key, edge: "before" };
  } else {
    const firstImplicitRow = withoutVisible.find((item) => !item.rememberable);
    if (firstImplicitRow) return { key: firstImplicitRow.key, edge: "before" };
  }
  const last = withoutVisible[withoutVisible.length - 1];
  return last ? { key: last.key, edge: "after" } : null;
}

export function previewKeys(full: readonly ReorderItem[], fromKey: string, at: number): string[] {
  const moved = full.find((item) => item.key === fromKey);
  if (!moved || at < 0) return full.map((item) => item.key);
  const without = full.filter((item) => item.key !== fromKey);
  return [...without.slice(0, at), moved, ...without.slice(at)].map((item) => item.key);
}

/** Menu / keyboard one-slot move: the insertion index in the without-visible
 *  list, or null at the partition edge (and for an unremembered project). */
export function stepInsertion(items: readonly ReorderItem[], from: number, delta: -1 | 1): number | null {
  const { start, end, inside } = blockRange(items, from);
  if (!inside) return null;
  if (delta < 0) return from <= start ? null : from - 1;
  return from >= end - 1 ? null : from + 1;
}
