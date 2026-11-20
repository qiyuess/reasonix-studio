import type { KeyboardEvent } from "react";

/** The arrow keys walk a menu's own enabled items; Home and End jump to the
 *  ends. Every popup that says `data-action-keydown="…menu"` shares it. */
export function workspaceMenuKeys(ev: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
  ev.preventDefault();
  ev.stopPropagation();
  const items = Array.from(ev.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'));
  if (!items.length) return;
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const to = ev.key === "Home" ? 0 : ev.key === "End" ? items.length - 1 : (at + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[to].focus();
}
