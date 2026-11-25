import { inScope, sessionRuntime } from "./sessionScope";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { hidesLegacySessions, onHidesLegacySessionsChange } from "../state/prefs";
import { onSessionQuickActionsChange, showsSessionQuickActions } from "../state/sessionQuick";
import { onRecencySortChange, recencySort, setRecencySort } from "../state/recencySort";
import { onRailGroupOrderChange, railGroupOrder, setRailGroupOrder } from "../state/railGroupOrder";
import { onRailRunFoldChange, railRunFold, setRailRunFold } from "../state/railRunFold";
import { onRailTimeGroupsChange, railTimeGroups, setRailTimeGroups } from "../state/railTimeGroups";
import { monthBuckets } from "./timeBuckets";
import { t } from "../i18n";
import type { TreeScope, TreeSession, TreeWorkspace } from "../port/hub";
import { workspaceContains } from "../port/hub";
import { HttpError } from "../port/http_error";
import { pinToViewport } from "./place";
import { useRailQuery } from "./railsearch";
import { saveSessionFile } from "./sessionExport";
import { useTreeKeys } from "./tree";
import { useDismiss } from "./dismiss";
import { clearDraftForSession } from "./drafts";
import { useSessionMoveTo } from "./useSessionMoveTo";
import { useSlotReorder } from "./useSlotReorder";
import type { ReorderItem } from "./reorder";
import { dragGhost } from "./dragghost";
import { pinnedFirst } from "./pinorder";
import { NO_PAGING, unloaded } from "./treewindow";
import type { WorkspacesProps } from "./workspaceprops";
import { useSelectedRows } from "./SessionBatch";
import type { GroupDragProps } from "./WorkspaceGroupHeaders";
import { workspaceGroups, groupFold, togglePath } from "./workspaceGroups";
import { workspaceRemoval } from "./workspaceRemove";
import { useSessionMutation, type SessionMutation } from "./useSessionMutation";
import { GROUP_DRAG_KIND, PROJECT_KIND, PROJECT_LIST, SESSION_KIND, rowLabel } from "./workspacesShared";
import { newlyDone } from "./newlydone";

export function useWorkspacesModel({
  hub, tree, treeRead, runtimes, active, folded, reload,
  paging = NO_PAGING, previewLimit = Infinity, opening = "", onOpen, onFocus,
  onClose, liveIds, listedIds = liveIds, runs, scope = "all", pinned = new Set(),
  onPin = () => {}, onArchive = async () => {},
  onError, adder, children, hasOtherRows,
}: WorkspacesProps) {
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState("");
  // The project whose folder an open just found gone: the question is asked about it, not about a removal chosen from the menu.
  const [gone, setGone] = useState("");
  const failIn = (ws: TreeWorkspace, e: unknown) => {
    if (e instanceof HttpError && e.reason?.code === "workspace.folder_missing") { setGone(ws.root); setConfirm(ws.root); } else onError(e);
  };
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // A run's label folds the whole run: the folder rows and every conversation
  // under them — whether or not any folder holds a session. The per-folder
  // chevrons keep their own, persisted fold; this one is the label's, kept in
  // the same store so a reload opens the same shape.
  const collapsedRuns = useSyncExternalStore(onRailRunFoldChange, railRunFold, railRunFold);
  // The row a Delete key asked about. The question replaces that row, so focus
  // goes back to it once the question is gone, or a keyboard is left nowhere.
  const askedByKey = useRef("");
  const needle = useRailQuery();
  useEffect(() => { setSelection((current) => current === null ? null : new Set()); }, [needle, scope]);
  // The projects run's plus: a two-item menu at the pointer's bottom-left —
  // an empty named folder, or a folder the person already has — and the
  // blank-project dialog the first item opens.
  const [projAdd, setProjAdd] = useState<{ x: number; y: number } | null>(null);
  const projAddBox = useRef<HTMLDivElement>(null);
  const projAddTrigger = useRef<HTMLElement | null>(null);
  // The plus is the anchor both ways: the menu opens under it, and closing the
  // menu hands the keyboard back to it rather than to the document body.
  const dismissProjAdd = () => {
    setProjAdd(null);
    projAddTrigger.current?.focus();
  };
  const [blankOpen, setBlankOpen] = useState(false);
  // 项目 rename: a small card asking for the name the sidebar reads by.
  const [renameFor, setRenameFor] = useState<{ root: string; name: string } | null>(null);
  const renameCard = useRef<HTMLDivElement>(null);
  // The projects plus' menu dismisses on anything else: an outside click, a
  // scroll of the tree, Escape.
  useEffect(() => {
    if (!projAdd) return;
    const outside = (ev: MouseEvent) => {
      const menu = projAddBox.current;
      if (!menu?.contains(ev.target as Node)) setProjAdd(null);
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") dismissProjAdd(); };
    window.addEventListener("mousedown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [projAdd]);
  // Opened, the menu takes the keyboard: without this it hangs off the end of
  // the document with focus still on the plus, so its own arrow keys never run.
  useEffect(() => {
    if (projAdd) projAddBox.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
  }, [projAdd]);
  useLayoutEffect(() => {
    if (projAddBox.current) pinToViewport(projAddBox.current, projAdd?.x ?? 0, projAdd?.y ?? 0, 8);
  }, [projAdd]);
  const toggleSelection = (path: string) => setSelection((current) => togglePath(current, path));
  const treeKeys = useTreeKeys();
  const mutations = useSessionMutation(onError);
  const [editing, setEditing] = useState("");
  const hideLegacy = useSyncExternalStore(onHidesLegacySessionsChange, hidesLegacySessions, hidesLegacySessions);
  const quickActions = useSyncExternalStore(onSessionQuickActionsChange, showsSessionQuickActions, showsSessionQuickActions);
  const recency = useSyncExternalStore(onRecencySortChange, recencySort, recencySort);
  // A reorder is a manual order: the reading on screen must be the list being
  // written, or the drop lands in one order while the screen keeps another.
  const manualOrder = () => {
    if (recency !== "off") setRecencySort("off");
    if (timeGroups) setRailTimeGroups(false);
  };
  const groupOrder = useSyncExternalStore(onRailGroupOrderChange, railGroupOrder, railGroupOrder);
  const timeGroups = useSyncExternalStore(onRailTimeGroupsChange, railTimeGroups, railTimeGroups);
  const [sessionMenu, setSessionMenu] = useState("");
  const moveTo = useSessionMoveTo(hub, tree, reload, rowLabel, () => adder.add());
  const [sessionMenuAt, setSessionMenuAt] = useState({ x: 0, y: 0 });
  const sessionMenuBox = useRef<HTMLDivElement>(null);
  const sessionMenuPortal = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const dismissMenu = () => {
    if (menuTrigger.current?.dataset.target === sessionMenu) menuTrigger.current.focus();
    setSessionMenu("");
  };
  const openRowMenu = (root: string, trigger: HTMLElement, at?: { x: number; y: number }) => {
    menuTrigger.current = trigger;
    const anchor = trigger.getBoundingClientRect();
    setSessionMenuAt(at ?? { x: anchor.right + 8, y: anchor.top - 7 });
    setSessionMenu(root);
  };
  useDismiss(!!sessionMenu, sessionMenuBox, dismissMenu, sessionMenuPortal);
  useEffect(() => {
    if (sessionMenu && menuTrigger.current?.dataset.target === sessionMenu) {
      sessionMenuPortal.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
    }
  }, [sessionMenu]);
  useLayoutEffect(() => {
    if (sessionMenuPortal.current) pinToViewport(sessionMenuPortal.current, sessionMenuAt.x, sessionMenuAt.y, 12);
  }, [sessionMenu, sessionMenuAt]);
  // The rename card centres itself, the way the blank-project dialog does. Its
  // style is position:fixed with no top or left, and it portals to the end of
  // the document, so without this it lands at the page's own bottom edge —
  // below the fold of a long sidebar, where a press on 重命名项目 looks like it
  // did nothing at all. Keyed on the root, not the card: typing a name must not
  // re-centre the box under the pointer.
  const renaming = renameFor?.root ?? "";
  useLayoutEffect(() => {
    if (!renaming) return;
    const put = () => {
      const el = renameCard.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      pinToViewport(el, (innerWidth - box.width) / 2, (innerHeight - box.height) / 2, 12);
    };
    put();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(put);
    if (renameCard.current) observer?.observe(renameCard.current);
    return () => observer?.disconnect();
  }, [renaming]);
  // Finishing is a transition this run witnessed, not a state a row can hold: a
  // persisted done replays nothing when the window opens or the scope changes.
  const priorRun = useRef<Record<string, string>>({});
  const [justDone, setJustDone] = useState<Set<string>>(new Set());

  // A first sighting only records what the state already was, so a row that is
  // done as it mounts is history and says so silently. Each timer clears only
  // the ids it added, which is why nothing has to be cancelled when `runs`
  // moves on: the animation has already been spent by then.
  useEffect(() => {
    const fresh = newlyDone(priorRun.current, runs);
    if (fresh.length === 0) return;
    setJustDone((prev) => new Set([...prev, ...fresh]));
    window.setTimeout(() => {
      setJustDone((prev) => {
        const next = new Set(prev);
        for (const id of fresh) next.delete(id);
        return next;
      });
    }, 1200);
  }, [runs]);
  // Folders whose next page is being read, or could not be.
  const [paged, setPaged] = useState<Record<string, "loading" | "failed">>({});
  const more = async (root: string) => {
    setPaged((prev) => ({ ...prev, [root]: "loading" }));
    try {
      await paging.more(root);
      setPaged(({ [root]: _, ...rest }) => rest);
    } catch {
      setPaged((prev) => ({ ...prev, [root]: "failed" }));
    }
  };
  const [spread, setSpread] = useState<Set<string>>(new Set());
  // Two folders can share a name — a worktree copy carries the project's own.
  // Only then is the extra word worth the room it takes. One counting pass,
  // not a scan of every prefix per row.
  const twice = useMemo(() => {
    const seen = new Map<string, number>();
    for (const w of tree) seen.set(w.name, (seen.get(w.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([n]) => n));
  }, [tree]);

  // A row that is already open is a pane to focus, never a second runtime for
  // one transcript — the kernel refuses that, and it is what forked a recovery
  // branch on every save when two writers shared a file.
  const pick = async (ws: TreeWorkspace, session: TreeSession) => {
    // The tree and runtime list arrive from separate reads. During a close or
    // restore the tree can briefly retain an id that no longer exists; focusing
    // that stale id changes no pane and makes the row look unclickable.
    const held = sessionRuntime(session, runtimes);
    if (held) {
      onFocus(held.id);
      return;
    }
    try {
      await onOpen({ root: session.workspaceRoot || ws.root, sessionPath: session.path });
    } catch (e) {
      failIn(ws, e);
    }
  };

  const startSession = async (ws: TreeWorkspace) => {
    setBusy("new:" + ws.root);
    try {
      await onOpen({ root: ws.root });
    } catch (e) {
      failIn(ws, e);
    } finally {
      setBusy("");
    }
  };

  // The task run's plus: the window's own kind of conversation — no project,
  // no picker; the kernel resolves it into the auto workspace itself.
  const startTaskSession = async () => {
    setBusy("new:");
    try {
      await onOpen({ noProject: true });
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  };

  const panesOf = (root: string) => {
    const workspace = tree.find((ws) => ws.root === root);
    return runtimes.filter((rt) => !rt.host && (workspace ? workspaceContains(workspace, rt.root) : rt.root === root)).map((rt) => rt.id);
  };

  const { removeWorkspaceNow } = workspaceRemoval({
    hub, tree, panesOf, liveIds, onClose, reload, onError,
  });

  const dropWorkspace = async (ws: TreeWorkspace) => {
    if (confirm !== ws.root) {
      setGone("");
      setConfirm(ws.root);
      return;
    }
    setConfirm("");
    setGone("");
    try {
      await removeWorkspaceNow(ws);
      await reload();
    } catch (e) {
      onError(e);
    }
  };

  useEffect(() => {
    const path = askedByKey.current;
    if (!path || confirm === path) return;
    askedByKey.current = "";
    // Another question took over: its own button holds focus now.
    if (confirm) return;
    const rows = treeKeys.ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [];
    for (const el of rows) if (el.dataset.target === path) el.focus();
  }, [confirm, treeKeys.ref]);

  const askDelete = (path: string) => {
    askedByKey.current = path;
    setConfirm(path);
  };

  const mutate = (session: TreeSession, kind: SessionMutation) => {
    if (sessionMenu) dismissMenu();
    const row = [...(treeKeys.ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find((el) => el.dataset.target === session.path) ?? null;
    void mutations.run(session.path, kind, row, () => kind === "read" ? hub.markSessionRead(session.path).then(reload) : kind === "pin" ? onPin(session.path) : onArchive(session.path, !session.archived, session.runtimeId));
  };
  const archive = (session: TreeSession) => mutate(session, "archive");

  const dropSession = async (session: TreeSession, withCopies = false) => {
    if (confirm !== session.path) {
      setConfirm(session.path);
      return;
    }
    // The row is about to go, and focus with it: the next row takes it, or the
    // one before when this was the last.
    const rows = [...(treeKeys.ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const asked = treeKeys.ref.current?.querySelector('[role="alertdialog"]');
    const after = asked ? rows.findIndex((el) => asked.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) : -1;
    const heir = after >= 0 ? rows[after] : rows[rows.length - 1];
    setConfirm("");
    try {
      // An idle pane is closed and waited on, since its runtime holds the
      // transcript's lease until it is down. A running one is left for the
      // kernel to refuse: a delete never stops work in progress.
      if (session.runtimeId && liveIds([session.runtimeId]).length === 0) await onClose([session.runtimeId]);
      // A plain delete keeps copies that hold content the conversation lacks; taking
      // them along removes each first, so a refused copy leaves the conversation in place.
      if (withCopies) for (const copy of session.copies ?? []) await hub.removeSession(copy.path);
      await hub.removeSession(session.path);
      clearDraftForSession("", session.path);
      await reload();
      if (document.activeElement && document.activeElement !== document.body) return;
      (heir?.isConnected ? heir : treeKeys.ref.current?.querySelector<HTMLElement>('[role="treeitem"]'))?.focus();
    } catch (e) {
      onError(e);
    }
  };

  const autoName = async (session: TreeSession) => {
    setBusy("name:" + session.path);
    try {
      const { title } = await hub.autoNameSession(session.path);
      await hub.renameSession(session.path, title);
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
      setSessionMenu("");
    }
  };

  const saveSession = async (session: TreeSession, format: "json" | "md" = "json") => {
    setBusy("export:" + session.path);
    try {
      await saveSessionFile(hub, session, format);
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
      setSessionMenu("");
    }
  };

  // A project reads by the name the person gave it; the folder's own basename
  // stands in while it has none.
  const shownName = (w: TreeWorkspace) => w.displayName?.trim() || w.name;
  const hit = (ws: TreeWorkspace) => {
    if (!needle) return ws;
    const named = (x: TreeSession) => (x.title || x.name || "").toLowerCase().includes(needle);
    if (shownName(ws).toLowerCase().includes(needle)) return ws;
    const sessions = ws.sessions.filter(named);
    return sessions.length || ws.countsComplete === false ? { ...ws, sessions } : null;
  };
  /** The newest stamp in a project, for ordering projects among themselves. A
   *  conversation without one is being written right now, which makes its
   *  project the most recent thing in the column. */
  const newest = (ws: TreeWorkspace) => ws.sessions.reduce((at, session) => Math.max(at, session.lastActiveAt ?? Date.now()), 0);
  const projectNodes = tree.filter((w) => !w.auto);
  const projectOptions = projectNodes.map((w) => ({ root: w.root, name: shownName(w) }));
  const projectItems: ReorderItem[] = projectNodes.map((w) => ({ key: w.root, pinned: !!w.pinned, rememberable: !!w.remembered }));
  // The rendered session rows answer the menu's one-slot moves; the callback is
  // filled below, once the visible pipeline has run.
  const visibleRef = useRef<(listId: string) => string[]>(() => []);
  const reorder = useSlotReorder({
    list: (listId, key) => {
      if (listId === PROJECT_LIST) return { kind: PROJECT_KIND, itemSelector: '[data-reorder-item="project"]', items: projectItems };
      const ws = tree.find((w) => w.root === listId);
      const session = ws?.sessions.find((s) => s.path === key);
      if (!ws || !session) return null;
      const peers = pinnedFirst(ws.sessions.filter((s) => !!s.archived === !!session.archived), pinned);
      return {
        kind: SESSION_KIND,
        itemSelector: '[data-reorder-item="session"]',
        items: peers.map((s) => ({ key: s.path, pinned: pinned.has(s.path), rememberable: true })),
      };
    },
    visible: (listId) => visibleRef.current(listId),
    place: async (listId, from, before) => {
      if (listId === PROJECT_LIST) await hub.placeWorkspace(from, before);
      else await hub.placeSession(from, before);
    },
    reload,
    onError,
    onBegin: manualOrder,
  });
  const searchedTree = needle ? (tree.map(hit).filter(Boolean) as TreeWorkspace[]) : tree;
  // The time-section reading sorts newest first, whichever way the sort
  // control last leaned: the sections themselves are the order.
  const recencyUsed = timeGroups ? "newest" : recency;
  // The row order a just-finished drop named, ahead of the reload that will
  // say the same thing: the preview names the project keys, the rest keep their
  // relative place after them.
  const projectPreview = reorder.previewFor(PROJECT_LIST);
  /** The order a drop just named, ahead of the reload that will say the same
   *  thing; rows the preview does not name keep their relative place. */
  function byPreview<T>(keys: string[] | null, keyOf: (row: T) => string): (rows: T[]) => T[] {
    if (!keys) return (rows) => rows;
    const at = new Map(keys.map((key, i) => [key, i]));
    return (rows) => [...rows].sort((a, b) => (at.get(keyOf(a)) ?? keys.length) - (at.get(keyOf(b)) ?? keys.length));
  }
  const sessionDragging = !!reorder.dragging && tree.some((ws) => ws.sessions.some((s) => s.path === reorder.dragging));
  const arrangedTree = byPreview(projectPreview, (w: TreeWorkspace) => w.root)(searchedTree);
  // How much each folder holds, before this view filtered its rows. Reading the
  // filtered list instead would answer "nothing left" for a folder in which
  // everything is archived — the very state the sidebar has to notice.
  const folderTotals = useMemo(() => {
    const out = new Map<string, { total: number; archived: number }>();
    for (const ws of tree) {
      out.set(ws.root, {
        total: ws.total ?? ws.sessions.length,
        archived: ws.archived ?? ws.sessions.filter((session) => !!session.archived).length,
      });
    }
    return out;
  }, [tree]);
  const shownTree = arrangedTree
    .map((ws) => ({
      ...ws,
      sessions: pinnedFirst(ws.sessions
        .filter((session) => inScope(session, scope, !!needle, !!session.runtimeId && listedIds([session.runtimeId]).length > 0, pinned.has(session.path), hideLegacy, !!session.runtimeId && runs[session.runtimeId]?.run === "halt"))
        // 最近 reorders the rows the kernel sent, newest first or the other way
        // round; pinned rows still lead. Unsorted leaves the kernel's order be.
        .sort((a, b) => {
          const d = (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
          return recencyUsed === "newest" ? d : recencyUsed === "oldest" ? -d : 0;
        }), pinned),
    }))
    .filter((ws) => {
      // A count still in flight cannot say a project is finished: hide nothing
      // until the kernel has answered.
      if (ws.countsComplete === false) return true;
      // A search asks to be shown what it found, and an archived conversation
      // answering one is the point — the row says that it is archived.
      if (needle) return true;
      if (scope !== "all") return ws.sessions.length > 0;
      // 全部 reads a folder as present while anything in it is still active.
      // Archiving is a property of conversations, not of folders, so this is
      // the whole of what "an archived project" means: every conversation in it
      // is archived, and it belongs to Archived alone. Counting from the
      // kernel's totals matters because a folder that has been paged in shows
      // only part of its rows. A folder holding nothing at all is a project
      // just added, still waiting for its first conversation — hiding it would
      // take away the only place to start one in it.
      const counting = folderTotals.get(ws.root) ?? { total: ws.sessions.length, archived: 0 };
      return counting.total === 0 || counting.total > counting.archived;
    })
    // 最近 orders the projects too, each by the newest conversation inside it:
    // a project is as recent as the last thing said in it. A pinned project
    // leads both readings — that is the whole of what a pin promises.
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const d = newest(b) - newest(a);
      return recencyUsed === "newest" ? d : recencyUsed === "oldest" ? -d : 0;
    });
  // A fold is a resting-state preference: while a word is being typed it would
  // hide the very rows that word just found.
  const searching = !!needle;
  const loadedRows = (root: string) => tree.find((x) => x.root === root)?.sessions.length ?? 0;
  // What the kernel is asked to count: the archived rows when that is the view,
  // otherwise the active ones, and everything while a word is being searched
  // for, since a search is allowed to find an archived conversation.
  const kernelScope: TreeScope = scope === "archived" ? "archived" : searching ? "" : "active";
  const [asked, setAsked] = useState(needle);
  useEffect(() => {
    if (!needle) return setAsked("");
    const wait = setTimeout(() => setAsked(needle), 250);
    return () => clearTimeout(wait);
  }, [needle]);
  useEffect(() => {
    paging.view({ scope: kernelScope, q: asked });
  }, [paging, kernelScope, asked]);
  const pagedScope = scope === "all" || scope === "archived";
  const visibleSessions = (ws: TreeWorkspace) => needle || scope !== "all" || selection || expanded.has(ws.root)
    ? ws.sessions : ws.sessions.filter((session, index) => index < previewLimit || session.runtimeId === active || session.path === opening);
  // A project's archive state is derived, never stored: it reads as archived
  // when every conversation it holds is. The kernel's totals cover the whole
  // folder — including the pages this window has not loaded — so the press
  // reaches conversations off screen too, which is what the menu promises.
  //
  // A running conversation refuses the whole batch at the kernel, so it is not
  // something this press can change: counting it would offer an action that
  // answers with a refusal the moment it is pressed.
  const archiveCounts = (ws: TreeWorkspace) => {
    const total = ws.total ?? ws.sessions.length;
    const archived = ws.archived ?? ws.sessions.filter((session) => !!session.archived).length;
    const busy = ws.sessions.filter((session) => !session.archived && !!session.runtimeId && liveIds([session.runtimeId]).length > 0).length;
    return { total, archived, active: Math.max(0, total - archived - busy) };
  };
  visibleRef.current = (listId) => {
    if (listId === PROJECT_LIST) return shownTree.filter((w) => !w.auto).map((w) => w.root);
    const ws = shownTree.find((w) => w.root === listId);
    return ws ? visibleSessions(ws).map((s) => s.path) : [];
  };
  const orderedVisible = (ws: TreeWorkspace, rows: TreeSession[]) =>
    byPreview(reorder.previewFor(ws.root), (row: TreeSession) => row.path)(rows);

  /** The project row's checkbox is the folder, not a fold control: picking it
   *  picks every row the folder shows, and picking it again clears them. */
  // Draw order: the two runs in the order a drag left them in.
  const groups = workspaceGroups(shownTree);
  const runOrder: ("projects" | "tasks")[] = groupOrder === "tasks-first" ? ["tasks", "projects"] : ["projects", "tasks"];
  const ordered = runOrder.flatMap((group) => groups[group]);
  // The time-section reading: each run's rows gather under the month of their
  // latest activity — the projects among themselves, the tasks among
  // themselves. The sections are cut here so the render only asks where one
  // begins.
  const projectBuckets = timeGroups ? monthBuckets(groups.projects.map((w) => ({ key: w.root, at: newest(w) }))) : null;
  const taskBuckets = timeGroups
    ? monthBuckets(groups.tasks.flatMap((w) => visibleSessions(w).map((s) => ({ key: s.path, at: s.lastActiveAt ?? Date.now() }))))
    : null;
  const sectionHead = (label: string) => (
    <div className="wstime" role="presentation">{label}</div>
  );
  // The group head and the row must read foldability the same way, or a click
  // on the label can disagree with the chevrons it just moved.
  const hasKids = (ws: TreeWorkspace) => ws.sessions.length > 0 || ws.countsComplete === false || ws.listingState === "degraded" || (pagedScope && unloaded(ws, loadedRows(ws.root)) > 0);
  const projectsFold = groupFold(groups.projects, folded, hasKids);
  const tasksFold = groupFold(groups.tasks, folded, hasKids);
  // A count still in flight is not an empty run: the notes wait for the tree
  // to settle before saying a run holds nothing.
  const settled = tree.every((ws) => ws.countsComplete !== false);
  const tasksEmpty = settled && (groups.tasks.length === 0 || groups.tasks.every((ws) => ws.sessions.length === 0));
  const displayed = ordered.filter((ws) => needle || !folded.has(ws.root))
    .flatMap(visibleSessions);
  const selected = useSelectedRows(displayed, selection, setSelection);
  const otherRows = hasOtherRows ? hasOtherRows(needle, hideLegacy) : !!children;
  // The tree at rest — no query or scope on: this is when an empty run speaks,
  // and its standing label folds what it says.
  const restEmpty = !needle && scope === "all" && treeRead && !otherRows;
  const saveRename = async () => {
    if (!renameFor) return;
    const name = renameFor.name.trim();
    if (!name) return;
    try {
      await hub.setWorkspaceDisplayName(renameFor.root, name);
      setRenameFor(null);
      await reload();
    } catch (e) {
      onError(e);
    }
  };
  const toggleRun = (group: "projects" | "tasks") => setRailRunFold((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    return next;
  });
  // The 任务列表 head folds both runs at once, the same persisted rest store
  // the two labels write: everything but the labels themselves goes away,
  // and a reload opens the same shape.
  const bothFolded = collapsedRuns.has("projects") && collapsedRuns.has("tasks");
  const toggleBothRuns = () => {
    setRailRunFold(!bothFolded ? new Set(["projects", "tasks"]) : new Set());
  };
  // Dragging one group's label onto the other swaps the two runs; the label is
  // the handle, and the swap rests in the group-order store.
  const [groupDrag, setGroupDrag] = useState<{ from: "projects" | "tasks"; over: { group: "projects" | "tasks"; edge: "before" | "after" } | null } | null>(null);

  /** The side of the target the carried run lands on. With two runs the only
   *  outcome is a swap, so this is decided by the standing order: a run
   *  carried up from below lands over its target, one carried down from
   *  above lands under it. The painted line and the drop read this one
   *  answer, so what the eye sees is what the drop does. */
  const carriedEdge = (from: "projects" | "tasks"): "before" | "after" =>
    railGroupOrder() === (from === "projects" ? "projects-first" : "tasks-first") ? "after" : "before";
  const groupDragProps = (group: "projects" | "tasks"): GroupDragProps => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(GROUP_DRAG_KIND, group);
      dragGhost(e, group === "projects" ? t("common.project") : t("session.tasks"));
      setGroupDrag({ from: group, over: null });
    },
    onDragOver: (e) => {
      if (!groupDrag || groupDrag.from === group) return;
      if (![...(e.dataTransfer?.types ?? [])].includes(GROUP_DRAG_KIND)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setGroupDrag((was) => (was?.over?.group === group && was.over.edge === carriedEdge(groupDrag.from) ? was : was ? { ...was, over: { group, edge: carriedEdge(groupDrag.from) } } : was));
    },
    onDragLeave: (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && (e.currentTarget as HTMLElement).contains(to)) return;
      setGroupDrag((was) => (was?.over?.group === group ? { ...was, over: null } : was));
    },
    onDrop: (e) => {
      if (!groupDrag || groupDrag.from === group) return;
      if (![...(e.dataTransfer?.types ?? [])].includes(GROUP_DRAG_KIND)) return;
      e.preventDefault();
      // Two runs and one possible outcome — the carried run takes the
      // other's place — so the side is a fact about the order, not about
      // where inside the row the pointer was: carried up from below, it
      // lands above the target; carried down from above, it lands below.
      const from = groupDrag.from;
      const edge = carriedEdge(from);
      setGroupDrag(null);
      const first = edge === "before" ? from : group;
      setRailGroupOrder(first === "projects" ? "projects-first" : "tasks-first");
    },
    onDragEnd: () => setGroupDrag(null),
  });

  return {
    busy, setBusy, confirm, setConfirm, gone, setGone, selection, setSelection, expanded, setExpanded,
    collapsedRuns, needle, projAdd, setProjAdd, projAddBox, projAddTrigger, blankOpen, setBlankOpen,
    renameFor, setRenameFor, renameCard, toggleSelection, treeKeys, mutations, editing, setEditing,
    quickActions, timeGroups, sessionMenu, setSessionMenu, moveTo, sessionMenuBox, sessionMenuPortal,
    dismissMenu, openRowMenu, justDone, paged, more, spread, setSpread, twice, pick, startSession,
    startTaskSession, panesOf, dropWorkspace, askDelete, mutate, archive, dropSession, autoName,
    saveSession, shownName, newest, projectOptions, reorder, sessionDragging, shownTree, searching,
    loadedRows, kernelScope, asked, pagedScope, visibleSessions, archiveCounts, orderedVisible, groups,
    runOrder, projectBuckets, taskBuckets, sectionHead, hasKids, projectsFold, tasksFold, settled,
    tasksEmpty, displayed, selected, otherRows, restEmpty, saveRename, toggleRun, bothFolded,
    toggleBothRuns, groupDrag, groupDragProps,
  };
}
