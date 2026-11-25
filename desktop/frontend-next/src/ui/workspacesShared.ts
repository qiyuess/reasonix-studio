import { t } from "../i18n";
import type { TreeSession } from "../port/hub";

export const parentOf = (root: string) => root.replace(/[/\\]+$/, "").split(/[/\\]/).slice(-2, -1)[0] ?? "";

// A conversation a pane holds before its first turn is written has only a file
// name; calling it that would show a timestamp where every other row shows words.
export const rowLabel = (session: TreeSession) =>
  session.title || (session.runtimeId && !session.turns ? t("common.new_session") : session.name);

// The drag payload of a group-label reorder: only drags that carry it move a
// run, the way the row reorder carries its own kind.
export const GROUP_DRAG_KIND = "application/x-reasonix-group";
// Both sidebar lists share one slot model; their kinds keep a project drag from
// dropping into a conversation list and a conversation drag from naming a project.
export const PROJECT_LIST = "projects";
export const PROJECT_KIND = "application/x-reasonix-workspace";
export const SESSION_KIND = "application/x-reasonix-session";
