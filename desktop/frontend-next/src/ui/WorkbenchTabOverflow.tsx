import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StudioIcon } from "./StudioIcon";
import { useDismiss } from "./dismiss";
import { menuKeys, useMenuFocus } from "./menufocus";
import { useFollow, pinToViewport } from "./place";

/** "+n ⌄" at the end of a strip too narrow for its tabs: the ones it cannot show,
 *  to pick from.
 *
 *  The list is portalled to the body and fixed, not dropped inside the strip.
 *  Docked, that strip is drawn on the window bar, and the window bar is the
 *  shell's title bar: anything painted inside it is title bar too, so the rows
 *  would take drag-the-window presses instead of clicks, and the bar's own
 *  height would clip a list longer than one line. Off the bar it is an ordinary
 *  menu again, and the drag rule never sees it. */
export function WorkbenchTabOverflow({ tabs, onPick }: { tabs: { key: string; label: string }[]; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const shut = useCallback(() => setOpen(false), []);
  // The menu is not a DOM descendant of its trigger, so the button is named as
  // a second inside box; without it every press on the list reads as a press
  // away and closes the thing being pressed.
  useDismiss(open, menu, shut, trigger);
  // A portal takes the list out of the trigger's subtree, so focus is handed to
  // it on open and back to the button on close: see menufocus.ts.
  useMenuFocus(open, menu, trigger);
  const onKeys = useCallback(menuKeys(shut), [shut]);
  // Right-aligned with the button and just below it, so it reads as hanging off
  // the end of the strip, and pinned into the viewport so the list never opens
  // past an edge.
  const place = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    const el = menu.current;
    if (!anchor || !el) return;
    pinToViewport(el, anchor.right - el.getBoundingClientRect().width, anchor.bottom + 4);
  }, []);
  useFollow(open, place, tabs.length);
  if (tabs.length === 0) return null;
  return (
    <span className="workbench-overflow">
      <button ref={trigger} type="button" className="workbench-overflow-btn" data-action="workbench.tab-overflow"
        aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        +{tabs.length}
        <StudioIcon name="down" />
      </button>
      {open && createPortal(
        <div className="workbench-overflow-menu" role="menu" ref={menu} data-action-keydown="workbench.tab-overflow"
          onKeyDown={onKeys}>
          {tabs.map((tab) => (
            <button key={tab.key} type="button" role="menuitem" data-action="workbench.tab" data-target={tab.key}
              onClick={() => { setOpen(false); onPick(tab.key); }}>
              {tab.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
