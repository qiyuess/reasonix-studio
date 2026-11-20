import { useRef, useState, type DragEvent } from "react";
import { dragGhost } from "./dragghost";
import { placeAt, pointerInsertion, previewKeys, slotAt, stepInsertion } from "./reorder";
import type { DropLine, ReorderItem } from "./reorder";

export type ReorderList = { kind: string; items: ReorderItem[]; itemSelector: string };

type Drag = { listId: string; key: string };
type Pending = { listId: string; from: string; before: string; previewAt: number };
type Preview = { listId: string; keys: string[] };
type Slot = { pending: Pending; line: DropLine };

export type ReorderConfig = {
  /** The full manual list for a list id, or null when it cannot be reordered. */
  list: (listId: string, key: string) => ReorderList | null;
  /** The rendered keys, in order, for a list id. */
  visible: (listId: string) => string[];
  place: (listId: string, from: string, before: string) => Promise<void>;
  reload: () => Promise<void>;
  onError: (e: unknown) => void;
  /** A reorder is a manual order: rest the clock/timeline reading first. */
  onBegin: () => void;
};

/** One native-DnD model for both sidebar lists. The pointer names a slot; the
 *  line is painted at that slot, and the drop asks the kernel for that one
 *  place. The visible row order is read from the DOM, so folds, filters and the
 *  preview window all agree with what the pointer sees. */
export function useSlotReorder(config: ReorderConfig) {
  const cfg = useRef(config);
  cfg.current = config;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<DropLine | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const resolve = (listId: string, key: string, root: HTMLElement, y: number): Slot | null => {
    const list = cfg.current.list(listId, key);
    if (!list) return null;
    const byKey = new Map(list.items.map((item) => [item.key, item]));
    const els = [...root.querySelectorAll<HTMLElement>(list.itemSelector)];
    const items: ReorderItem[] = [];
    const boxes: { top: number; height: number }[] = [];
    for (const el of els) {
      const item = byKey.get(el.dataset.reorderKey ?? "");
      if (!item) continue;
      // An expanded project's block includes its conversations. The slot a
      // project means is decided by its folder row: a pointer anywhere in the
      // run below that row is after the whole project, not before its middle.
      const face = el.querySelector<HTMLElement>(":scope > .wsrow") ?? el;
      const box = face.getBoundingClientRect();
      items.push(item);
      boxes.push({ top: box.top, height: box.height });
    }
    const from = items.findIndex((item) => item.key === key);
    if (from < 0) return null;
    const insertion = pointerInsertion(items, from, slotAt(boxes, y));
    if (insertion === null) return null;
    const placement = placeAt(items, list.items, key, insertion);
    if (!placement.line) return null;
    return {
      pending: { listId, from: key, before: placement.before, previewAt: placement.previewAt },
      line: placement.line,
    };
  };

  const start = (ev: DragEvent<HTMLElement>, listId: string, key: string, label: string) => {
    const list = cfg.current.list(listId, key);
    if (!list) return;
    cfg.current.onBegin();
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData(list.kind, key);
    dragGhost(ev, label);
    setDrag({ listId, key });
    setOver(null);
  };

  const hover = (ev: DragEvent<HTMLElement>, listId: string) => {
    if (!drag || drag.listId !== listId) return;
    const list = cfg.current.list(listId, drag.key);
    if (!list || ![...(ev.dataTransfer?.types ?? [])].includes(list.kind)) return;
    const found = resolve(listId, drag.key, ev.currentTarget as HTMLElement, ev.clientY);
    if (!found) {
      setOver(null);
      return;
    }
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    setOver(found.line);
  };

  const leave = (ev: DragEvent<HTMLElement>) => {
    if (!drag) return;
    const to = ev.relatedTarget as Node | null;
    if (to && (ev.currentTarget as HTMLElement).contains(to)) return;
    setOver(null);
  };

  const apply = async (pending: Pending, list: ReorderList) => {
    setPreview({ listId: pending.listId, keys: previewKeys(list.items, pending.from, pending.previewAt) });
    setDrag(null);
    setOver(null);
    try {
      await cfg.current.place(pending.listId, pending.from, pending.before);
      await cfg.current.reload();
      setPreview(null);
    } catch (e) {
      setPreview(null);
      cfg.current.onError(e);
    }
  };

  const drop = (ev: DragEvent<HTMLElement>, listId: string) => {
    if (!drag || drag.listId !== listId) return;
    const list = cfg.current.list(listId, drag.key);
    const found = resolve(listId, drag.key, ev.currentTarget as HTMLElement, ev.clientY);
    if (!found || !list) return;
    ev.preventDefault();
    void apply(found.pending, list);
  };

  const end = () => {
    setDrag(null);
    setOver(null);
  };

  const visibleItems = (listId: string, key: string): ReorderItem[] | null => {
    const list = cfg.current.list(listId, key);
    if (!list) return null;
    const byKey = new Map(list.items.map((item) => [item.key, item]));
    return cfg.current.visible(listId)
      .map((visibleKey) => byKey.get(visibleKey))
      .filter((item): item is ReorderItem => !!item);
  };

  const moveBy = (listId: string, key: string, delta: -1 | 1) => {
    const list = cfg.current.list(listId, key);
    const items = visibleItems(listId, key);
    if (!list || !items) return;
    const from = items.findIndex((item) => item.key === key);
    const insertion = stepInsertion(items, from, delta);
    if (insertion === null) return;
    const placement = placeAt(items, list.items, key, insertion);
    if (!placement.line) return;
    cfg.current.onBegin();
    void apply({ listId, from: key, before: placement.before, previewAt: placement.previewAt }, list);
  };

  const canMove = (listId: string, key: string, delta: -1 | 1) => {
    const items = visibleItems(listId, key);
    if (!items) return false;
    return stepInsertion(items, items.findIndex((item) => item.key === key), delta) !== null;
  };

  return {
    dragging: drag?.key ?? "",
    over,
    previewFor: (listId: string) => (preview?.listId === listId ? preview.keys : null),
    start,
    hover,
    leave,
    drop,
    end,
    moveBy,
    canMove,
  };
}
