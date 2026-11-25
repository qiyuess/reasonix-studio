import { Fragment, memo } from "react";
import { dayBucket } from "./timeBuckets";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import type { TreeSession, TreeWorkspace } from "../port/hub";
import { zoom } from "./place";
import { StudioIcon } from "./StudioIcon";
import { TreeEmpty, TreeReading } from "./TreeReading";
import { ListingProgress } from "./ListingProgress";
import { copyText } from "./CopyButton";
import { sessionInfoText } from "./sessionInfo";
import { asksDelete } from "./keys";
import { ProjectMenu } from "./ProjectMenu";
import { SessionMenu } from "./SessionMenu";
import { BlankProjectDialog } from "./BlankProjectDialog";
import { workspaceMenuKeys } from "./menuKeys";
import { Hit } from "./Hit";
import { Confirm, removeHint, sessionDeleteHint } from "./WorkspaceConfirm";
import { LeadDot, UnreadCount } from "./UnreadMark";
import { NO_PAGING, atCap, answers, unloaded } from "./treewindow";
import type { WorkspacesProps } from "./workspaceprops";
import { SessionBatch } from "./SessionBatch";
import { ProjectsHeader } from "./ProjectsHeader";
import { WorkspaceGroupHead } from "./WorkspaceGroupHeaders";
import { SessionTail } from "./SessionAge";
import { SessionArchiveAction, SessionPinAction } from "./SessionRowActions";

import { useWorkspacesModel } from "./useWorkspacesModel";
import { PROJECT_LIST, parentOf, rowLabel } from "./workspacesShared";

function WorkspacesView({ hub, tree, treeRead, answered = null, runtimes, active, folded, reload, retry, paging = NO_PAGING, previewLimit = Infinity, onFold, opening = "", onOpen, onFocus, onClose, liveIds, listedIds = liveIds, runs, scope = "all", pinned = new Set(), onPin = () => {}, onPause = () => {}, onBranch, onArchive = async () => {}, onArchiveQuiet, onRename, onError, adder, children, hasOtherRows }: WorkspacesProps) {
  const {
    busy, setBusy, confirm, setConfirm, gone, setGone, selection, setSelection, setExpanded,
    collapsedRuns, needle, projAdd, setProjAdd, projAddBox, projAddTrigger, blankOpen, setBlankOpen,
    renameFor, setRenameFor, renameCard, toggleSelection, treeKeys, mutations, editing, setEditing,
    quickActions, timeGroups, sessionMenu, setSessionMenu, moveTo, sessionMenuBox, sessionMenuPortal,
    dismissMenu, openRowMenu, justDone, paged, more, spread, setSpread, twice, pick, startSession,
    startTaskSession, panesOf, dropWorkspace, askDelete, mutate, archive, dropSession, autoName,
    saveSession, shownName, projectOptions, reorder, sessionDragging, shownTree, searching,
    loadedRows, kernelScope, asked, pagedScope, visibleSessions, archiveCounts, orderedVisible, groups,
    runOrder, projectBuckets, taskBuckets, sectionHead, hasKids, projectsFold, tasksFold, settled,
    tasksEmpty, displayed, selected, otherRows, restEmpty, saveRename, toggleRun, bothFolded,
    toggleBothRuns, groupDrag, groupDragProps,
  } = useWorkspacesModel({
    hub, tree, treeRead, answered, runtimes, active, folded, reload, retry, paging, previewLimit,
    onFold, opening, onOpen, onFocus, onClose, liveIds, listedIds, runs, scope, pinned, onPin,
    onPause, onBranch, onArchive, onArchiveQuiet, onRename, onError, adder, children, hasOtherRows,
  });
  // One run of the tree: its label, the note an empty run says at rest, and —
  // unless the label folded them away — its rows. The label folds the whole
  // run, folder rows and conversations alike, whether or not any folder holds
  // a session. While a query or scope is on the label stands unclickable, and
  // TreeEmpty says what the view holds instead.
  const renderRun = (group: "projects" | "tasks") => {
    const list = groups[group];
    const fold = group === "projects" ? projectsFold : tasksFold;
    const collapsed = collapsedRuns.has(group);
    return (
      <Fragment key={group}>
        {/* One head for every shape of run: the label folds the whole run —
            the folder rows and every conversation under them — through the
            persisted rest store, so a reload opens the same shape. Remote
            rows on the tree or a scope on the view must not take the fold
            away; the query is the only thing that stands the label
            unclickable, and even then the head reads as its disabled
            button. The row's plus answers its own run: the projects' adds a
            project, the tasks' opens the window's own kind of conversation. */}
        <WorkspaceGroupHead group={group} folded={searching ? fold.folded : collapsed} canFold={!searching} searching={searching}
          onToggle={() => toggleRun(group)} dragProps={groupDragProps(group)}
          dropping={groupDrag?.over?.group === group ? groupDrag.over.edge : undefined} dragging={groupDrag?.from === group}
          onAdd={group === "projects" ? (at) => {
            // The menu's top-left corner sits at the plus button's own
            // bottom-left: the button is the anchor, not the pointer. The
            // rect reads in screen pixels and the menu's fixed position
            // lives inside the page's zoom, so the anchor is divided by it —
            // the same math pinning the other floaters uses.
            const box = at.currentTarget.getBoundingClientRect();
            projAddTrigger.current = at.currentTarget;
            setProjAdd({ x: box.left / zoom(), y: (box.bottom + 6) / zoom() });
          } : () => void startTaskSession()}
          adding={adder.busy || busy === "new:"} />
        {restEmpty && !collapsed && group === "projects" && list.length === 0 && (
          <>
            <div className="ws-none">{t("session.no_projects_yet")}</div>
            {tree.length === 0 && (
              <button className="projects-open" data-action="workspace.add"
                disabled={adder.busy} onClick={() => adder.add()}><StudioIcon name="folder" />{t("session.open_your_first_project")}</button>
            )}
          </>
        )}
        {restEmpty && !collapsed && group === "tasks" && (list.length === 0 || tasksEmpty) && (
          <div className="ws-none">{t("session.no_tasks_yet")}</div>
        )}
        {/* A fold is a resting-state preference: while a query is on, the rows
            it would hide are the very rows the query just found, so the run
            opens for the search no matter how it was put away. */}
        {(!collapsed || !!needle) && list.map((ws) => {
            // A fold is a resting-state preference; while a query is on it would hide
            // the very rows the query just found.
            const hasChildren = hasKids(ws);
            const visible = visibleSessions(ws);
            const hidden = ws.sessions.length - visible.length;
            const shut = hasChildren && !needle && folded.has(ws.root);
            // Only while the question is on screen: panesOf walks every runtime.
            const doomed = confirm === ws.root ? panesOf(ws.root) : [];
            const busyPanes = liveIds(doomed).length;
            // The section this row opens, when the time reading is on: the
            // first row of its day-bucket in its own run, under the run's label.
            const section = group === "projects"
              ? projectBuckets?.marks.get(ws.root)
              : undefined;
            return (
                <div className="wsnode" key={ws.root} data-root={ws.root} data-current={panesOf(ws.root).includes(active) ? "" : undefined} data-missing={ws.missing ? "" : undefined}
                  data-reorder-item={ws.auto ? undefined : "project"}
                  data-reorder-key={ws.auto ? undefined : ws.root}
                  data-drop={!ws.auto && reorder.over?.key === ws.root ? reorder.over.edge : undefined}>
                {section && sectionHead(section)}
                {/* The 任务 area has no folder row of its own: the head is the label,
                    and its conversations hang directly beneath it. */}
                {!ws.auto && (confirm === ws.root ? (
                  <Confirm
                    what={gone === ws.root ? t("session.folder_gone_remove_from_list", { name: ws.name }) : t("session.remove_name_from_the_list", { name: ws.name })}
                    hint={removeHint(doomed.length, busyPanes)}
                    go={t("common.remove")}
                    danger={busyPanes > 0}
                    onGo={() => void dropWorkspace(ws)}
                    onCancel={() => { setConfirm(""); setGone(""); }}
                  />
                ) : (
                  <div
                    ref={sessionMenu === ws.root ? sessionMenuBox : undefined}
                    data-action-click="workspace.fold"
                    data-action-contextmenu="workspace.menu"
                    data-action-keydown="workspace.menu"
                    data-action-dragstart="workspace.reorder"
                    data-action-dragend="workspace.reorder"
                    data-target={ws.root}
                    data-dragging={reorder.dragging === ws.root ? "" : undefined}
                    draggable={!needle}
                    onDragStart={(ev) => { if (!needle) reorder.start(ev, PROJECT_LIST, ws.root, ws.name); }}
                    onDragEnd={reorder.end}
                    className="wsrow ds-proj"
                    role="treeitem"
                    aria-level={1}
                    aria-haspopup="menu"
                    aria-expanded={hasChildren ? !shut : undefined}
                    aria-selected={selection ? visible.length > 0 && visible.every((s) => selection.has(s.path)) : undefined}
                    onClick={() => {
                      // Picking is a session-only mode: a folder row takes no
                      // part in it, and its click keeps folding the run.
                      if (selection) return;
                      if (hasChildren) onFold(ws.root, !shut);
                    }}
                    onContextMenu={(ev) => {
                      if ((ev.target as HTMLElement).closest("input, textarea, [role='menu']")) return;
                      ev.preventDefault();
                      ev.stopPropagation();
                      openRowMenu(ws.root, ev.currentTarget, ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : undefined);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.target !== ev.currentTarget) return;
                      if (ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10")) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        openRowMenu(ws.root, ev.currentTarget);
                        return;
                      }
                      // The menu no longer carries moving a project — that is the
                      // row's own drag — so the keyboard keeps the same pair of
                      // steps the drag performs, as a conversation row does.
                      if (!ws.auto && ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
                        const direction = ev.key === "ArrowUp" ? -1 : 1;
                        if (needle || !reorder.canMove(PROJECT_LIST, ws.root, direction)) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        reorder.moveBy(PROJECT_LIST, ws.root, direction);
                      }
                    }}
                  >
                    {/* The folder carries the fold itself: an open folder while
                        the run shows, a closed one while it is put away — the
                        row's edge carries no separate fold arrow. */}
                    <StudioIcon name={hasChildren && !shut ? "reveal" : "folder"} />
                    <span className="wsname ds-title" title={ws.root}>
                      {shownName(ws)}
                    </span>
                    {/* A tag is this project's identity, so it takes a second line and the name keeps the row. */}
                    {(ws.isolated || twice.has(ws.name)) && (
                      <span className="wsmeta">
                        <em className="wstag">{ws.isolated ? t("common.isolated") : parentOf(ws.root)}</em>
                      </span>
                    )}
                    <span className="wsacts">
                      {shut && <UnreadCount n={ws.sessions.filter((x) => x.unread).length} />}
                      <span className="rowswap">
                      <span className="rowbtns">
                      <button
                        data-action="session.new"
                        className="wsadd"
                        data-busy={busy === "new:" + ws.root ? "" : undefined}
                        disabled={ws.missing}
                        title={t("common.start_a_new_session_in", { name: shownName(ws) })}
                        aria-label={t("common.start_a_new_session_in", { name: shownName(ws) })}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void startSession(ws);
                        }}
                      >
                        <StudioIcon name="plus" />
                      </button>
                      <button
                        className="wsmore"
                        data-action="workspace.menu"
                        data-target={ws.root}
                        title={t("common.more_actions")}
                        aria-label={t("common.project_actions_name", { name: ws.name })}
                        aria-expanded={sessionMenu === ws.root}
                        aria-haspopup="menu"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (sessionMenu === ws.root) setSessionMenu("");
                          else openRowMenu(ws.root, ev.currentTarget);
                        }}
                      >
                        <StudioIcon name="more" />
                      </button>
                      </span>
                      </span>
                    </span>
                    {sessionMenu === ws.root && (
                      <ProjectMenu
                        ref={sessionMenuPortal}
                        ws={ws}
                        archived={archiveCounts(ws).total > 0 && archiveCounts(ws).archived === archiveCounts(ws).total}
                        archivable={archiveCounts(ws).active}
                        restorable={archiveCounts(ws).archived}
                        onRename={() => { setRenameFor({ root: ws.root, name: shownName(ws) }); dismissMenu(); }}
                        onPin={() => { void hub.setWorkspacePinned(ws.root, !ws.pinned).then(reload).catch(onError); dismissMenu(); }}
                        onArchiveSessions={(archived) => {
                          dismissMenu();
                          // The kernel decides the reach from the folder's own
                          // listing, so conversations past the loaded page go
                          // with it. A running one refuses the whole press and
                          // the reason reaches the same onError a row uses.
                          void hub.archiveWorkspace(ws.root, archived).then(reload).catch(onError);
                        }}
                        onRemove={() => { setConfirm(ws.root); dismissMenu(); }}
                        hub={hub}
                        dismiss={dismissMenu}
                        onError={onError}
                      />
                    )}
                  </div>
                ))}

                {/* 子项自己成一块，才能拿到那条层级引导线。缩进单独说不清楚层级：
                    两级差 18px，扫一眼只读得出“有点错位”。 */}
                {!shut && hasChildren && (
                  <div className="kids" data-reorder-list={ws.root} data-session-drag={sessionDragging ? "" : undefined}
                    data-action-dragover="session.reorder" data-action-dragleave="session.reorder" data-action-drop="session.reorder"
                    onDragOver={(ev) => reorder.hover(ev, ws.root)}
                    onDragLeave={reorder.leave}
                    onDrop={(ev) => reorder.drop(ev, ws.root)}>
                {orderedVisible(ws, visible).map((session) => sessionRow(session, ws))}

                <ListingProgress workspace={ws} searching={searching} onRetry={retry} />
                {pagedScope && (hidden > 0 || unloaded(ws, loadedRows(ws.root)) > 0) && (
                  hidden === 0 && atCap(loadedRows(ws.root)) ? (
                    <small className="sessnote">{ws.countsComplete === false ? t("session.search_to_find_more_conversations") : t("session.n_older_conversations_use_search", { n: unloaded(ws, loadedRows(ws.root)) })}</small>
                  ) : (
                    <button
                      className="sessmore"
                      disabled={paged[ws.root] === "loading"}
                      data-action="session.more"
                      onClick={() => {
                        setExpanded((current) => new Set(current).add(ws.root));
                        if (unloaded(ws, loadedRows(ws.root)) > 0 && !atCap(loadedRows(ws.root))) void more(ws.root);
                      }}
                    >
                      {paged[ws.root] === "loading"
                        ? t("session.loading")
                        : paged[ws.root] === "failed"
                          ? t("common.failed_to_load_retry")
                          : ws.countsComplete === false ? t("session.show_more") : t("common.show_more_n_left", { n: hidden + unloaded(ws, loadedRows(ws.root)) })}
                    </button>
                  )
                )}
                  </div>
                )}
              </div>
            );
        })}
      </Fragment>
    );
  };
  // The time-section reading replaces the folder tree with one timeline: every
  // listed conversation, newest first, gathered under the day it last moved,
  // each row naming what it belongs to — a project's name, or 任务 for the
  // window's own.
  const flatRows = timeGroups
    ? shownTree
        .flatMap((ws) => visibleSessions(ws).map((session) => ({ session, ws })))
        .sort((a, b) => (b.session.lastActiveAt ?? Date.now()) - (a.session.lastActiveAt ?? Date.now()))
    : [];

  // One conversation row, shared by the folder tree and the flat time
  // reading alike: the flat timeline adds the line naming what the
  // conversation belongs to — a project's name, or 任务 for the window's own.
  const sessionRow = (session: TreeSession, ws: TreeWorkspace, subtitle?: string) => {

                    const on = opening ? session.path === opening : session.runtimeId === active;
                    const run = session.runtimeId ? runs[session.runtimeId]?.run : undefined;
                    if (confirm === session.path) {
                      return (
                        <Confirm
                          key={session.path}
                          what={t("common.delete_name", { name: rowLabel(session) })}
                          hint={sessionDeleteHint(session.copies?.length ?? 0, !!session.runtimeId, !!session.runtimeId && liveIds([session.runtimeId]).length > 0)}
                          go={t("common.delete")}
                          danger
                          alt={(session.copies?.length ?? 0) > 0 ? { label: t("session.delete_with_n_copies", { n: session.copies!.length }), onGo: () => void dropSession(session, true) } : undefined}
                          onGo={() => void dropSession(session)}
                          onCancel={() => setConfirm("")}
                        />
                      );
                    }
                    const versions = session.versions ?? [];
                    const copies = session.copies ?? [];
                    const kept = [...versions.map((s) => ({ s, version: true })), ...copies.map((s) => ({ s, version: false }))];
                    const open = spread.has(session.path);
                    // The month section this conversation opens, when the time
                    // reading is on.
                    // The flat reading cuts its own sections from the render
                    // order; only the folder view marks rows here.
                    const section = subtitle ? undefined : taskBuckets?.marks.get(session.path);
                    return (
                      <Fragment key={session.path}>
                        {section && sectionHead(section)}
                      <div
                        ref={sessionMenu === session.path ? sessionMenuBox : undefined}
                        data-action-click={selection ? "session.selection" : "session.open"}
                        data-action-contextmenu="session.menu"
                        aria-haspopup="menu"
                        data-action-keydown={selection ? ["session.selection"] : ["session.open", "session.delete", "session.menu", "session.move"]}
                        data-target={session.path}
                        className="sessrow sessrow-context ds-row"
                        data-sub={subtitle ? "" : undefined}
                        role="treeitem"
                        aria-level={2}
                        aria-label={rowLabel(session)}
                        aria-selected={selection ? selection.has(session.path) : on}
                        data-on={on ? "" : undefined}
                        data-live={session.runtimeId ? "" : undefined}
                        data-run={run === "idle" ? undefined : run}
                        data-unread={session.unread ? "" : undefined}
                        data-just-done={session.runtimeId && justDone.has(session.runtimeId) ? "" : undefined}
                        data-busy={opening === session.path || mutations.pending.has(session.path) ? "" : undefined}
                        data-drop={reorder.over?.key === session.path ? reorder.over.edge : undefined}
                        data-dragging={reorder.dragging === session.path ? "" : undefined}
                        data-reorder-item={subtitle ? undefined : "session"}
                        data-reorder-key={subtitle ? undefined : session.path}
                        draggable={subtitle || selection || !!needle ? undefined : true}
                        onClick={(ev) => { if (selection) toggleSelection(session.path); else if (ev.detail < 2 && mutations.pending.get(session.path) !== "archive") void pick(ws, session); }}
                        data-action-dblclick={selection ? undefined : "session.rename"}
                        onDoubleClick={(ev) => {
                          if (selection || mutations.pending.has(session.path) || (ev.target as HTMLElement).closest("input, button, [role='menu']")) return;
                          setEditing(session.path);
                        }}
                        onContextMenu={(ev) => {
                          if ((ev.target as HTMLElement).closest("input, textarea, [role='menu']")) return;
                          if (selection || mutations.pending.has(session.path)) { ev.preventDefault(); return; }
                          ev.preventDefault();
                          ev.stopPropagation();
                          openRowMenu(session.path, ev.currentTarget, { x: ev.clientX, y: ev.clientY });
                        }}
                        data-action-dragstart={subtitle ? undefined : "session.reorder"}
                        data-action-dragend={subtitle ? undefined : "session.reorder"}
                        onDragStart={subtitle ? undefined : (ev) => { if (!needle && !selection) reorder.start(ev, ws.root, session.path, rowLabel(session)); }}
                        onDragEnd={subtitle ? undefined : reorder.end}
                        tabIndex={0}
                        onKeyDown={(ev) => {
                          if (ev.target !== ev.currentTarget) return;
                          if (mutations.pending.has(session.path)) return;
                          if (editing === session.path) return;
                          if (selection) {
                            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); toggleSelection(session.path); }
                            return;
                          }
                          if (ev.key === "ContextMenu" || ev.shiftKey && ev.key === "F10") {
                            ev.preventDefault(); ev.stopPropagation(); openRowMenu(session.path, ev.currentTarget);
                          } else if (ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
                            ev.preventDefault(); ev.stopPropagation();
                            const direction = ev.key === "ArrowUp" ? -1 : 1;
                            if (!needle && reorder.canMove(ws.root, session.path, direction)) reorder.moveBy(ws.root, session.path, direction);
                          } else if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            ev.stopPropagation();
                            void pick(ws, session);
                          } else if (asksDelete(ev)) {
                            ev.preventDefault();
                            askDelete(session.path);
                          }
                        }}
                      >
                        {selection && <input type="checkbox" className="session-select" tabIndex={-1} aria-label={t("session.select_session_name", { name: rowLabel(session) })}
                          data-action-click="session.selection" data-action-change="session.selection" data-target={session.path} checked={selection.has(session.path)}
                          onClick={(ev) => ev.stopPropagation()} onChange={() => toggleSelection(session.path)} />}
                        <LeadDot unread={session.unread && run !== "running" && run !== "halt"} />
                        {editing === session.path ? (
                          <input className="sessedit" aria-label={t("common.rename_this_session")} placeholder={t("common.chat_title")} autoFocus
                            defaultValue={session.title || session.name}
                            onClick={(ev) => ev.stopPropagation()}
                            data-action-blur="session.rename" data-action-keydown="session.rename" data-target={session.path}
                            onBlur={(ev) => {
                              const next = ev.currentTarget.value.trim();
                              setEditing("");
                              if (next !== "" && next !== (session.title || session.name).trim()) onRename(session.path, next, "inline");
                            }}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") {
                                ev.preventDefault();
                                ev.currentTarget.blur();
                              } else if (ev.key === "Escape") {
                                ev.preventDefault();
                                ev.stopPropagation();
                                ev.currentTarget.value = session.title || session.name;
                                ev.currentTarget.blur();
                              }
                            }} />
                        ) : (
                          <span className="sesstitle ds-title" title={rowLabel(session)}>
                            <span className="sessline"><Hit text={rowLabel(session)} needle={needle} />{session.isolated && <em className="sessarch" title={session.workspaceRoot}>{t("common.isolated")}</em>}{session.archived && <em className="sessarch">{t("common.archived")}</em>}
                            {session.metadataState === "pending" && <em className="sessarch">{t("session.reading_summary")}</em>}
                            {session.metadataState === "error" && <em className="sessarch">{t("session.summary_unavailable")}</em>}
                            </span>
                            {subtitle && <span className="sessub">{subtitle}</span>}
                          </span>
                        )}
                        {!selection && <SessionPinAction target={session.path} title={rowLabel(session)}
                          pinned={pinned.has(session.path)} enabled={quickActions} disabled={mutations.pending.has(session.path)} onPin={() => mutate(session, "pin")} />}
                        <SessionTail run={run} at={session.lastActiveAt ?? Date.now()} unread={session.unread} dot={false} />
                        {!selection && <SessionArchiveAction target={session.path} title={rowLabel(session)} archived={!!session.archived}
                          disabled={mutations.pending.has(session.path) || !!session.runtimeId && liveIds([session.runtimeId]).length > 0} onArchive={() => archive(session)} />}
                        {sessionMenu === session.path && (
                          <SessionMenu
                            ref={sessionMenuPortal}
                            session={session}
                            live={!!session.runtimeId && liveIds([session.runtimeId]).length > 0}
                            pinned={pinned.has(session.path)}
                            exporting={busy === "export:" + session.path}
                            autoNaming={busy === "name:" + session.path}
                            onPin={() => mutate(session, "pin")}
                            onMarkRead={session.unread ? () => mutate(session, "read") : undefined}
                            onRename={() => { setSessionMenu(""); onRename(session.path, session.title || session.name); }}
                            onAutoName={() => void autoName(session)}
                            onPause={() => { onPause(session.runtimeId!); setSessionMenu(""); }}
                            onClose={() => {
                              const id = session.runtimeId!;
                              setSessionMenu("");
                              void onClose([id]).catch(onError);
                            }}
                            onArchive={() => archive(session)}
                            onBranch={onBranch && session.runtimeId ? () => { setSessionMenu(""); void onBranch(session.runtimeId!, `${rowLabel(session)} · ${t("common.branch")}`).catch(onError); } : undefined}
                            onCopyInfo={() => { void copyText(sessionInfoText(session, session.workspaceRoot || ws.root)).catch(onError); setSessionMenu(""); }}
                            onExport={(format) => void saveSession(session, format)}
                            onBatchSelect={(picked) => { setSessionMenu(""); setSelection(new Set([picked.path])); }}
                            keptCount={kept.length} keptOpen={open} onKept={() => { setSpread((prev) => { const next = new Set(prev); if (open) next.delete(session.path); else next.add(session.path); return next; }); setSessionMenu(""); }}
                            onDelete={() => { askDelete(session.path); setSessionMenu(""); }}
                            onMoveTo={() => { setSessionMenu(""); moveTo.request(session, ws.root); }}
                          />
                        )}
                      </div>
                      {open &&
                        kept.map(({ s: copy, version }) =>
                          confirm === copy.path ? (
                            <Confirm
                              key={copy.path}
                              what={version ? t("session.delete_this_earlier_version") : t("session.delete_this_recovery_copy")}
                              hint={t("common.deletes_it_together_with_its")}
                              go={t("common.delete")}
                              danger
                              onGo={() => void dropSession(copy)}
                              onCancel={() => setConfirm("")}
                            />
                          ) : (
                            <div
                              data-action-click="session.open"
                              data-action-keydown={["session.open", "session.delete"]}
                              data-target={copy.path}
                              key={copy.path}
                              className="sessrow sesscopy ds-row"
                              role="treeitem"
                              aria-level={3}
                              aria-selected={opening === copy.path}
                              data-on={opening === copy.path ? "" : undefined}
                              data-busy={opening === copy.path ? "" : undefined}
                              onClick={() => void pick(ws, copy)}
                              tabIndex={0}
                              onKeyDown={(ev) => {
                                if (ev.target !== ev.currentTarget) return;
                                if (ev.key === "Enter" || ev.key === " ") {
                                  ev.preventDefault();
                                  void pick(ws, copy);
                                } else if (asksDelete(ev)) {
                                  ev.preventDefault();
                                  askDelete(copy.path);
                                }
                              }}
                            >
                              <span className="ds-lead" />
                              <span className="sesstitle ds-title" title={rowLabel(copy)}>
                                <span>{version ? t("session.earlier_version_n_turns", { n: copy.turns ?? 0 }) : t("session.recovery")}</span>
                              </span>
                              <button
                                className="wsdel"
                                data-action="session.delete"
                                data-target={copy.path}
                                title={t("session.delete_this_session")}
                                aria-label={t("session.delete_this_session")}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setConfirm(copy.path);
                                }}
                              >
                                <StudioIcon name="trash" />
                              </button>
                            </div>
                          ),
                        )}
                      </Fragment>
  );
  };

  return (
    <>
      {moveTo.dialog}
      {projAdd && createPortal(
        // session-pop carries the fixed positioning that makes the anchor's
        // left/top mean anything; without it the menu is laid out at the end
        // of the document and the plus looks dead.
        <div ref={projAddBox} className="session-pop groupadd" role="menu" aria-label={t("session.add_a_new_project")}
          data-action-keydown="workspace.menu" onKeyDown={workspaceMenuKeys}
          style={{ left: projAdd.x, top: projAdd.y }}>
          <div className="session-pop-group">
            <button role="menuitem" data-action="workspace.add-blank" disabled={adder.busy}
              onClick={() => { setProjAdd(null); setBlankOpen(true); }}>
              <StudioIcon name="plus" /><span>{t("session.new_blank_project")}</span>
            </button>
            <button role="menuitem" data-action="workspace.add-existing" disabled={adder.busy}
              onClick={() => { setProjAdd(null); adder.add(); }}>
              <StudioIcon name="reveal" /><span>{t("session.use_existing_folder")}</span>
            </button>
          </div>
        </div>, document.body)}
      {blankOpen && createPortal(
        <BlankProjectDialog adder={adder} onDone={async () => { await reload(); }}
          onClose={() => setBlankOpen(false)} onError={onError} />, document.body)}
      {renameFor && createPortal(
        <div ref={renameCard} className="workspace-blank" role="dialog" aria-label={t("session.rename_project")}>
          <div className="workspace-blank-head">
            <span className="workspace-blank-mark"><StudioIcon name="edit" /></span>
            <button className="workspace-palette-close" aria-label={t("common.close")} data-action="workspace.rename-close" onClick={() => setRenameFor(null)}><StudioIcon name="close" /></button>
          </div>
          <h2>{t("session.rename_project")}</h2>
          <p className="picknote">{renameFor.root}</p>
          <label className="workspace-blank-field">
            <span>{t("session.project_display_name")}</span>
            <input autoFocus data-action-blur="workspace.rename" data-action-change="workspace.rename" data-action-keydown="workspace.rename" value={renameFor.name} onChange={(ev) => setRenameFor({ ...renameFor, name: ev.currentTarget.value })}
              onKeyDown={(ev) => { if (ev.key === "Enter" && renameFor.name.trim()) void saveRename(); }} />
          </label>
          <div className="workspace-blank-go">
            <button data-action="layer.dismiss" onClick={() => setRenameFor(null)}>{t("common.cancel")}</button>
            <button className="pick" data-action="workspace.rename" disabled={!renameFor.name.trim()} onClick={() => void saveRename()}>{t("common.save")}</button>
          </div>
        </div>, document.body)}
      <ProjectsHeader bothFolded={bothFolded} searching={searching} onToggleBoth={() => toggleBothRuns()} />
      <div className="scroll">
        <div role="tree" aria-label={t("session.projects_and_conversations")} aria-multiselectable={selection !== null} inert={busy === "batch"} data-action-keydown="tree.navigate" data-action-dragover="workspace.reorder" data-action-dragleave="workspace.reorder" data-action-drop="workspace.reorder" ref={treeKeys.ref} onKeyDown={treeKeys.onKeyDown} onDragOver={(ev) => reorder.hover(ev, PROJECT_LIST)} onDragLeave={reorder.leave} onDrop={(ev) => reorder.drop(ev, PROJECT_LIST)}>
          {/* The first run's label stands before its rows even when the run is
              empty, so an empty tree reads as two runs — one for each kind of
              folder — and not as a missing column. */}
          {timeGroups && (() => {
            let section = "";
            return flatRows.map(({ session, ws }) => {
              const bucket = dayBucket(session.lastActiveAt ?? Date.now());
              const opens = bucket.key !== section;
              section = bucket.key;
              return (
                <Fragment key={session.path}>
                  {opens && sectionHead(bucket.label)}
                  {sessionRow(session, ws, ws.auto ? t("session.tasks") : shownName(ws))}
                </Fragment>
              );
            });
          })()}
          {!timeGroups && runOrder.map((group) => renderRun(group))}
          {!otherRows && shownTree.length === 0 && (tree.length > 0 || treeRead && (!!needle || scope !== "all")) && <TreeEmpty settled={settled && answers(answered, { scope: kernelScope, q: asked })} onRetry={retry} />}
          {tree.length === 0 && !treeRead && <TreeReading onRetry={retry} />}
          {children}
        </div>
      </div>
      <SessionBatch hub={hub} selection={selection} selected={selected} displayed={displayed} onSelect={setSelection}
        projects={projectOptions}
        onExit={() => {
          // Back to the tree's own standing control. The menu entries that
          // start picking live inside closed menus, so the head is the way in;
          // a folded-everything head still answers with itself for the keyboard.
          const entry = document.querySelector<HTMLElement>('[data-action="workspace.fold-all"][data-value="projects"]');
          entry?.focus();
        }}
        onBusy={(pending) => { setBusy(pending ? "batch" : ""); if (pending) { setSessionMenu(""); setEditing(""); setConfirm(""); } }}
        onClose={onClose} onArchive={onArchive} onArchiveQuiet={onArchiveQuiet} autoRoot={tree.find((w) => w.auto)?.root}
        liveIds={liveIds} reload={reload} onError={onError} />
    </>
  );
}

// Panes report upward on every usage round, so the window repaints often; the
// tree it holds does not change nearly that often.
export const Workspaces = memo(WorkspacesView);
