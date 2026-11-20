import { useSyncExternalStore } from "react";
import { t } from "../i18n";
import { Picker, type MenuItem } from "./Menu";
import type { SessionScope } from "./sessionScope";
import { StudioIcon } from "./StudioIcon";
import { onRailTimeGroupsChange, railTimeGroups, setRailTimeGroups } from "../state/railTimeGroups";

export interface ScopeCounts { all: number; live: number; waiting: number; unread: number; pinned: number }

const NAME: Record<SessionScope, string> = { all: "common.all", live: "plan.step.now", waiting: "chat.needs_you", unread: "common.unread", pinned: "session.pinned_2", archived: "common.archived" };

export function SessionFilter({ scope, counts, onScope }: { scope: SessionScope; counts: ScopeCounts; onScope: (next: SessionScope) => void }) {
  const timeGroups = useSyncExternalStore(onRailTimeGroupsChange, railTimeGroups, railTimeGroups);
  const items: MenuItem[] = (["all", "live", "waiting", "unread", "pinned", "archived"] as const).map((value) => ({
    value,
    label: t(NAME[value]),
    right: value === "archived" ? undefined : String(counts[value]),
    divide: value === "archived",
  }));
  return (
    <div className="session-filter">
      {/* The clock beside the scope menu flips the time reading: each run's rows
          gather under the bucket their latest activity falls in. A toggle, not a
          third state — the sidebar either reads as sections or as the order the
          kernel keeps. */}
      <button type="button" className="session-filter-sort" data-action="session.sort"
        aria-pressed={timeGroups}
        title={t("session.sort_by_recent")} aria-label={t("session.sort_by_recent")}
        onClick={() => setRailTimeGroups(!timeGroups)}>
        <StudioIcon name="clock" />
      </button>
      <Picker
        className="session-filter-trigger"
        data-action="session.filter"
        place="bottom"
        align="end"
        current={scope}
        items={items}
        menuClassName="session-filter-menu"
        ariaLabel={t("session.session_scope")}
        label={<><span>{t(NAME[scope])}</span><StudioIcon name="down" /></>}
        onPick={(value) => onScope(value as SessionScope)}
      />
      {scope !== "all" && (
        <button type="button" className="session-filter-clear" data-action="session.filter-clear" aria-label={t("session.clear_filter")} onClick={() => onScope("all")}>
          <StudioIcon name="close" />
        </button>
      )}
    </div>
  );
}
