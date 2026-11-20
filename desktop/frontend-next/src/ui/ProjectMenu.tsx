import { forwardRef } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import type { HubPort, TreeWorkspace } from "../port/hub";
import { StudioIcon } from "./StudioIcon";
import { WorkspaceReveal } from "./WorkspaceReveal";
import { workspaceMenuKeys } from "./menuKeys";

export interface ProjectMenuProps {
  ws: TreeWorkspace;
  /** The project reads as archived when everything in it is. Archiving is a
   *  property of conversations, not of folders, so this is the whole of what a
   *  folder's archive state means — and the action below turns around with it. */
  archived: boolean;
  /** How many conversations the press would change. Zero leaves the item out of
   *  reach: a folder with nothing to archive, or nothing to restore. */
  archivable: number;
  restorable: number;
  onRename: () => void;
  onPin: () => void;
  /** Archive the whole project, or restore it, from the folder's own row. */
  onArchiveSessions: (archived: boolean) => void;
  onRemove: () => void;
  hub: HubPort;
  dismiss: () => void;
  onError: (e: unknown) => void;
}

/** A project's actions, drawn at the document root so the sidebar's clipping
 *  cannot cut them. Every action closes the menu itself. Moving a project is
 *  the row's own drag; it is not offered here. */
export const ProjectMenu = forwardRef<HTMLDivElement, ProjectMenuProps>(function ProjectMenu(
  { ws, archived, archivable, restorable, onRename, onPin, onArchiveSessions, onRemove, hub, dismiss, onError },
  ref,
) {
  return createPortal(
    <div ref={ref} className="session-pop" role="menu" aria-label={t("common.project_actions")} data-action-keydown="workspace.menu" data-target={ws.root} onKeyDown={workspaceMenuKeys} onClick={(ev) => ev.stopPropagation()}>
      <div className="session-pop-head">
        <b>{ws.name}</b>
        <small className="session-pop-path" title={ws.root}>{ws.root}</small>
      </div>
      <div className="session-pop-group">
        <button role="menuitem" data-action="workspace.rename-start" disabled={ws.missing} onClick={onRename}>
          <StudioIcon name="edit" /><span>{t("session.rename_project")}</span>
        </button>
        <button role="menuitem" data-action="workspace.pin" data-value={ws.pinned ? "off" : "on"} onClick={onPin}>
          <StudioIcon name="pin" /><span>{t(ws.pinned ? "session.unpin_project" : "session.pin_project")}</span>
        </button>
        <button role="menuitem" data-action="workspace.archive-sessions" data-value={archived ? "restore" : "archive"}
          disabled={(archived ? restorable : archivable) === 0} onClick={() => onArchiveSessions(!archived)}>
          <StudioIcon name="archive" /><span>{t(archived ? "session.unarchive_project_sessions" : "session.archive_project_sessions")}</span>
        </button>
      </div>
      <WorkspaceReveal ws={ws} hub={hub} dismiss={dismiss} onError={onError} />
      <div className="session-pop-group">
        <button className="danger" role="menuitem" data-action="workspace.remove" onClick={onRemove}>
          <StudioIcon name="close" /><span>{t("common.remove_from_the_list")}</span><small>{t("common.keeps_files")}</small>
        </button>
      </div>
    </div>,
    document.body,
  );
});
