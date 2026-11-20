import { useMemo, useSyncExternalStore } from "react";
import { t } from "../i18n";
import type { ApprovalMode } from "../port/port";
import { arranged, navLayout, onNavLayoutChange, ordered } from "../state/navEntries";
import { approvalName } from "./approvals";
import type { Section } from "./prefsnav";
import { MASK } from "./wallet";

/** A bar row's own key: one that is not a Section of the settings table is
 *  spelled here. */
export type Mark = "chat" | "files" | Section;
export type Destination = [mark: Mark, label: string, section: string, action?: string];

// One list of places the window can go, drawn twice: icon-only on the rail and
// with its name on the sidebar. Names are the settings table's own (prefsnav
// NAV), so a destination is called the same thing wherever it is offered.
export const DESTINATIONS: Destination[] = [
  ["usage", "app.usage", "usage"],
  ["files", "common.files", "files", "files.open"],
  ["tools", "app.tools_and_permissions", "tools"],
  ["ext", "ext.extension", "ext"],
  ["memory", "data.memory", "memory"],
  ["remote", "settings.remote", "remote"],
];

/** A row of the menu bar: the two commands it leads with, then the places it
 *  goes. They are arranged, drawn and hidden by one list, which is what the
 *  更多 panel shows — otherwise the two rows above the destinations would be
 *  the only entries nobody could reorder. */
export interface BarEntry {
  key: string;
  label: string;
  /** Absent on the two commands: they run something rather than go somewhere. */
  section?: string;
  action?: string;
  /** A command the bar cannot do without; the panel still lists it, but its
   *  switch is off the table. */
  fixed?: boolean;
  /** Drawn with these classes, which is what the stylesheet and the shortcut
   *  hints hang off. */
  className?: string;
}

export const BAR: BarEntry[] = [
  { key: "new", label: "common.start_a_new_session", action: "session.new", fixed: true, className: "studio-new-task" },
  { key: "search", label: "session.search_sessions_and_actions", action: "workspace.search", className: "studio-search" },
  ...DESTINATIONS.map(([mark, label, section, action]): BarEntry => ({
    key: mark as string, label, section, action, className: "studio-navrow",
  })),
];

const KEYS = BAR.map((entry) => entry.key);

/** Every row in this machine's order, hidden ones included: what the panel
 *  arranges. */
export function useBarLayout(): { list: BarEntry[]; hidden: Set<string> } {
  const layout = useSyncExternalStore(onNavLayoutChange, navLayout, navLayout);
  return useMemo(() => ({
    list: ordered(KEYS, layout).map((k) => BAR.find((entry) => entry.key === k)!),
    hidden: new Set(layout.hidden),
  }), [layout]);
}

/** What is drawn: the order without the hidden rows. A fixed row is never
 *  hidden, whatever the stored arrangement says. */
export function useBarEntries(): BarEntry[] {
  const { list, hidden } = useBarLayout();
  return useMemo(() => list.filter((entry) => entry.fixed || !hidden.has(entry.key)), [list, hidden]);
}

const DESTINATION_KEYS = DESTINATIONS.map(([mark]) => mark);

/** The destinations the icon rail draws, in this machine's order. */
export function useDestinations(): Destination[] {
  const layout = useSyncExternalStore(onNavLayoutChange, navLayout, navLayout);
  return useMemo(() => arranged(DESTINATION_KEYS, layout)
    .map((k) => DESTINATIONS.find(([mark]) => mark === k)!) as Destination[], [layout]);
}

/** What stands beside a destination's name: a balance, how many machines are
 *  online, the approval mode. The icon rail and the expanded sidebar read the
 *  same values, so neither can drift from the other's numbers. */
export function readingOf(key: string, values: { wallet: string; approval?: ApprovalMode; online: number; hideAmounts: boolean }): string {
  if (key === "usage") return values.wallet ? (values.hideAmounts ? MASK : values.wallet) : "";
  if (key === "remote") return values.online > 0 ? t("common.n_online", { n: values.online }) : "";
  if (key === "tools") return values.approval ? approvalName(values.approval) : "";
  return "";
}

/** Where a destination goes: files opens the file view, the rest name a settings
 *  section, and two of them are called something else there. */
export function targetOf(key: string, section: string): { files: boolean; section: string } {
  return {
    files: key === "files",
    section: key === "usage" ? "spend" : key === "ext" ? "extensions" : section,
  };
}
