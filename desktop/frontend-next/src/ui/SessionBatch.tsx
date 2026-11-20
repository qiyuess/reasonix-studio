import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import type { HubPort, TreeSession } from "../port/hub";
import { StudioIcon } from "./StudioIcon";
import { clearDraftForSession } from "./drafts";
import { useEscape } from "./dismiss";

/** The selected rows that are still on screen; a row that leaves the displayed set leaves the selection. */
export function useSelectedRows(displayed: TreeSession[], selection: Set<string> | null, setSelection: Dispatch<SetStateAction<Set<string> | null>>): TreeSession[] {
  const key = displayed.map((row) => row.path).join("\n");
  useEffect(() => {
    const paths = new Set(key ? key.split("\n") : []);
    setSelection((current) => {
      if (!current) return current;
      const next = new Set([...current].filter((path) => paths.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [key, setSelection]);
  return [...new Map(displayed.filter((row) => selection?.has(row.path)).map((row) => [row.path, row])).values()];
}

export function SessionBatch({ hub, selection, selected, displayed, projects = [], onSelect, onExit, onBusy, onClose, onArchive, onArchiveQuiet, autoRoot, liveIds, reload, onError }: {
  hub: HubPort;
  selection: Set<string> | null;
  selected: TreeSession[];
  displayed: TreeSession[];
  /** Projects the move-to picker offers; the tree feeds them in so a batch
   *  never invents a destination the sidebar does not know. */
  projects?: { root: string; name: string }[];
  onSelect: (next: Set<string> | null) => void;
  onExit: () => void;
  onBusy: (busy: boolean) => void;
  onClose: (ids: string[]) => Promise<void>;
  onArchive: (path: string, archived: boolean, runtimeId?: string) => Promise<void>;
  /** An archive that leaves the tree read to the caller: the batch does it once
   *  for the whole selection instead of once per row. */
  onArchiveQuiet?: (path: string, archived: boolean, runtimeId?: string) => Promise<void>;
  /** The auto workspace's root: a selected row writing there is a task
   *  conversation, and its delete takes the whole footprint. */
  autoRoot?: string;
  liveIds: (ids: string[]) => string[];
  reload: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "archive" | "restore" | "delete" | "move">("idle");
  const [movePicker, setMovePicker] = useState(false);
  const wasSelecting = useRef(selection !== null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const pending = phase !== "idle" && phase !== "confirm";
  const asking = phase === "confirm";
  const liveSelected = new Set(liveIds(selected.flatMap((row) => row.runtimeId ? [row.runtimeId] : [])));
  const running = liveSelected.size > 0;
  const blocked = pending || running || selected.length === 0;
  // Move disables itself per row: a live row is skipped while the rest still go,
  // so one running session cannot hold the whole batch's destination hostage.
  const moveBlocked = pending || asking || selected.length === 0;
  const all = displayed.length > 0 && displayed.every((row) => selection?.has(row.path));
  const restore = selected.length > 0 && selected.every((row) => row.archived);
  const cancel = () => { setPhase("idle"); setMovePicker(false); onBusy(false); deleteButton.current?.focus(); };
  useEscape(movePicker, () => setMovePicker(false));
  useEffect(() => {
    if (wasSelecting.current && selection === null) {
      onExit();
    }
    wasSelecting.current = selection !== null;
  }, [selection !== null]);
  useEffect(() => {
    if (phase === "idle" && selection !== null) (deleteButton.current?.disabled ? doneButton.current : deleteButton.current)?.focus();
  }, [phase, selection !== null]);

  /** One pass over the selection: each row's own request goes at once, one
   *  failure keeps just that row, and the tree is read once afterwards when a
   *  row asked for it. */
  const runBatch = async (
    phase: "archive" | "restore" | "delete" | "move",
    ready: boolean,
    apply: (row: TreeSession) => Promise<boolean>,
  ) => {
    if (!ready) return;
    setPhase(phase);
    onBusy(true);
    const failed = new Set<string>();
    let firstError: unknown;
    let touched = false;
    try {
      await Promise.all(selected.map(async (row) => {
        try { touched = (await apply(row)) || touched; }
        catch (e) {
          failed.add(row.path);
          firstError ??= e;
        }
      }));
      if (touched) {
        try { await reload(); } catch (e) { firstError ??= e; }
      }
      onSelect(failed);
    } finally {
      setPhase("idle");
      onBusy(false);
    }
    if (firstError) onError(firstError);
    deleteButton.current?.focus();
  };

  const run = (action: "archive" | "restore" | "delete") => runBatch(action, !blocked, async (row) => {
    if (row.runtimeId && liveIds([row.runtimeId]).length > 0) throw new Error(t("session.selected_sessions_are_running_stop"));
    if (action === "delete") {
      if (row.runtimeId) await onClose([row.runtimeId]);
      await hub.removeSession(row.path);
      clearDraftForSession("", row.path);
      return true;
    }
    await (onArchiveQuiet ?? onArchive)(row.path, action === "archive", row.runtimeId);
    // A quiet archive leaves the read to this pass; the loud one already asked.
    return !!onArchiveQuiet;
  });

  const move = async (target: string) => {
    setMovePicker(false);
    await runBatch("move", !moveBlocked, async (row) => {
      if (row.runtimeId && liveIds([row.runtimeId]).length > 0) throw new Error(t("session.selected_sessions_are_running_stop"));
      await hub.moveSessionTo(row.path, target);
      return true;
    });
  };

  const taskCount = autoRoot ? selected.filter((row) => row.workspaceRoot === autoRoot).length : 0;
  const projectCount = selected.length - taskCount;
  const startDelete = () => {
    if (taskCount > 0) {
      setPhase("confirm");
      onBusy(true);
      return;
    }
    void run("delete");
  };
  if (selection === null) return null;
  return (
    <div className="session-batch" aria-busy={pending}>
      <div className="session-batch-head">
        <button data-action="session.selection" data-value={all ? "clear" : "all"} disabled={phase !== "idle" || displayed.length === 0}
          aria-label={t(all ? "session.deselect_displayed_sessions" : "session.select_all_displayed_sessions")}
          onClick={() => {
            const next = new Set(selection);
            for (const row of displayed) { if (all) next.delete(row.path); else next.add(row.path); }
            onSelect(next);
          }}>{t(all ? "session.deselect_everything" : "session.select_all")}</button>
        <span className="session-batch-status" role="status">
          <span>{t("session.n_sessions_selected", { n: selected.length })}</span>
          {running && <span className="session-batch-hint">{t("session.selected_sessions_are_running_stop")}</span>}
          {pending && <span className="session-batch-hint">{t("session.processing_selected_sessions")}</span>}
        </span>
        <button ref={doneButton} className="x" data-action="session.selection" data-value="end" disabled={pending}
          aria-label={t("session.done_selecting")} title={t("session.done_selecting")}
          onClick={() => { cancel(); onSelect(null); }}><StudioIcon name="close" /></button>
      </div>
      {phase !== "confirm" && (
      <div className="session-batch-actions">
        <button data-action="session.batch-archive" data-value={restore ? "restore" : "archive"} disabled={blocked || asking || movePicker}
          aria-label={t(restore ? "session.unarchive_selected_sessions" : "session.archive_selected_sessions")} onClick={() => void run(restore ? "restore" : "archive")}>{t(restore ? "common.unarchive" : "common.archived_2")}</button>
        <button data-action="session.move-to-start" data-value="batch" disabled={moveBlocked || movePicker}
          aria-label={t("session.move_selected_sessions")} onClick={() => setMovePicker(true)}>{t("session.batch_move")}</button>
        <button ref={deleteButton} className="danger" data-action="session.batch-delete" disabled={blocked || asking || movePicker} aria-label={t("session.delete_selected_sessions")}
          onClick={startDelete}>{t("common.delete")}</button>
      </div>
      )}
      {phase === "confirm" && (
        <div className="wsconfirm" role="alertdialog" aria-label={t("session.delete_n_sessions", { n: selected.length })}
          data-action-keydown="layer.dismiss" onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); cancel(); } }}>
          <div className="wsconfirm-t">
            <span className="q">{t("session.delete_n_sessions", { n: selected.length })}</span>
            {taskCount > 0 && <span className="h">{t("session.batch_delete_tasks_hint", { n: taskCount })}</span>}
            {projectCount > 0 && <span className="h">{t("session.batch_delete_projects_hint", { n: projectCount })}</span>}
          </div>
          <div className="wsconfirm-a">
            <button autoFocus data-action="layer.dismiss" onClick={cancel}>{t("common.cancel")}</button>
            <button data-action="session.batch-delete" data-danger="" disabled={blocked} onClick={() => void run("delete")}>{t("common.delete")}</button>
          </div>
        </div>
      )}
      {movePicker && createPortal(
        <div className="session-batch-pick" role="menu" aria-label={t("session.choose_target_project")}
          data-action-keydown="layer.dismiss" onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setMovePicker(false); } }}>
          {projects.length === 0 ? (
            <p className="session-batch-pick-empty">{t("session.there_is_no_other_project")}</p>
          ) : projects.map((p) => (
            <button key={p.root} role="menuitem" data-action="session.move-to" data-target={selected.map((s) => s.path).join(",")} data-value={p.root}
              onClick={() => void move(p.root)}><StudioIcon name="folder" /><span>{p.name}</span><small>{p.root}</small></button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
