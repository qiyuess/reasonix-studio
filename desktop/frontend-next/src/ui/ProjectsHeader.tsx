import { useContext } from "react";
import { t } from "../i18n";
import { RailFilterContext } from "./railfilter";
import { WsMark } from "./WsMark";

/** The row above the tree: the view's name and the session filter. The name
 *  folds both runs at once — every folder that can fold, and every empty run's
 *  note — with the same arrow the group labels answer to. Folding a single
 *  group lives on the group labels; picking conversations starts from the
 *  tree's own right-click menus; ordering by recency lives in the filter menu,
 *  beside the scopes it reorders. */
export function ProjectsHeader({ bothFolded, searching, onToggleBoth }: {
  bothFolded?: boolean;
  searching?: boolean;
  onToggleBoth?: () => void;
}) {
  const filter = useContext(RailFilterContext);
  const said = t(bothFolded ? "session.expand_all_groups" : "session.collapse_all_groups");
  return (
    <div className="projects-header">
      <div className="projects-tabs">
        <button type="button" className="vtab" aria-current="true"
          data-action="workspace.fold-all" data-value="both"
          disabled={!onToggleBoth || searching}
          aria-expanded={onToggleBoth ? !bothFolded : undefined}
          title={said} aria-label={said}
          onClick={onToggleBoth}>
          {t("session.task_list")}
          <WsMark open={onToggleBoth ? !bothFolded : undefined} />
        </button>
        <span className="projects-spacer" />
        {filter}
      </div>
    </div>
  );
}
