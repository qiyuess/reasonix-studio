import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type KeyboardEvent } from "react";
import type { AgentPort } from "../port/port";
import { host } from "../port/host";
import type { LocalRefs } from "./Markdown";
import { GRANTED, conversationFile, isLocalPathShape } from "./filelinks";
import { GRANTED_FILE, grantedFileKey, grantedFilePath } from "./grantedfiles";
import { WorkbenchFileMenu, absoluteWorkspacePath, type FileMenu } from "./WorkbenchFileMenu";

// How long a spelled path may be looked up before the tab opens with it as
// written. A correct spelling answers in one stat; this only bounds the wrong
// ones, where the answer is a walk of the workspace.
const RESOLVE_WAIT_MS = 1500;

export function useConversationFiles(port: AgentPort, root: string, remote: boolean, shown: boolean, reveal: () => void, fail: (e: unknown) => void) {
  const [request, setRequest] = useState<{ path: string; port: AgentPort; root: string; consumed: () => void }>();
  const [menu, setMenu] = useState<(FileMenu & { id: number; port: AgentPort; root: string }) | null>(null);
  const menuID = useRef(0);
  const askID = useRef(0);
  // A link opens its file once: the workbench reports it taken, so a later press
  // on Files, or anything else that re-renders it, finds nothing to replay.
  //
  // A path the conversation spelled is read against the workspace root, though
  // the model writes it against whatever directory its shell ran in: `cd crate
  // && cargo build` leaves `target/release/app.exe`, and the file is under
  // `crate/`. The workspace is therefore asked where the tail really lives
  // before the tab opens — and the tab opens exactly once, with the answer, so a
  // path that was wrong leaves no failed tab behind to close by hand.
  //
  // Asking costs one stat when the spelling is already right, which is the usual
  // case. A spelling that is wrong is the expensive one, so the wait is bounded:
  // past RESOLVE_WAIT_MS the tab opens with what was written, which is what would
  // have happened without any of this.
  const ask = useCallback((path: string) => {
    const mine = ++askID.current;
    let settled = false;
    reveal();
    const open = (at: string) => {
      if (settled) return;
      settled = true;
      // A second link pressed while the first is still being looked up owns the
      // panel: the slower answer must not replace the newer request.
      if (askID.current !== mine) return;
      const req = { path: at, port, root, consumed: () => setRequest((now) => (now === req ? undefined : now)) };
      setRequest(req);
    };
    if (remote || !port.workspaceResolvePath) return open(path);
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); open(path); }, RESOLVE_WAIT_MS);
    void port.workspaceResolvePath(path, controller.signal).then((found) => {
      clearTimeout(timer);
      const at = found ? (found.root ? grantedFilePath(found.root, found.path) : found.path) : "";
      open(at || path);
    }).catch(() => {
      clearTimeout(timer);
      open(path);
    });
  }, [port, root, reveal, remote]);
  useEffect(() => () => setRequest(undefined), [port, root]);
  const [platform, setPlatform] = useState("");
  const close = useCallback(() => setMenu(null), []);
  // The folders the user granted this workspace: a picture in one is served by
  // the same controlled channel, named by the folder it lives in.
  const [granted, setGranted] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setGranted([]);
    void port.workspaceRoots?.().then((r) => { if (live) setGranted(r.extra ?? []); }).catch(() => {});
    return () => { live = false; };
  }, [port, root]);
  useEffect(close, [port, root, shown, close]);
  useEffect(() => { void host().describe().then((h) => setPlatform(h.platform)).catch(() => {}); }, []);
  const refs = useMemo<LocalRefs>(() => {
    const path = (href: string) => conversationFile(root, href);
    const grantedMark = (src: string) => {
      if (!isLocalPathShape(src)) return null;
      for (const [n, folder] of granted.entries()) {
        const rel = conversationFile(folder, src);
        if (rel) return `${GRANTED}/${n}/${rel}`;
      }
      return null;
    };
    const offer = (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, href: string) => {
      const file = path(href);
      if (!file || document.getSelection()?.isCollapsed === false) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const keyed = !("clientX" in e) || (e.clientX === 0 && e.clientY === 0);
      setMenu({ id: ++menuID.current, port, root, path: file, folder: false, anchor: e.currentTarget,
        x: keyed ? rect.left : e.clientX, y: keyed ? rect.bottom : e.clientY });
    };
    const image = (src: string): string | null => {
      const marked = src.startsWith(`${GRANTED}/`) ? /^[^/]+\/(\d+)\/(.+)$/.exec(src) : null;
      if (marked) {
        const folder = granted[Number(marked[1])];
        return folder ? port.workspaceImageURL(decodeURIComponent(marked[2]), folder) : null;
      }
      const file = path(src);
      if (file) return port.workspaceImageURL(file);
      const held = grantedMark(src);
      return held ? image(held) : null;
    }
    // A path in text may become a link when it is in the workspace or in a granted folder.
    const linkable = (href: string) => path(href) ?? (isLocalPathShape(href) ? grantedFileKey(granted, href) : null);
    return {
      file: (ref) => () => ask(ref.root ? grantedFilePath(ref.root, ref.path) : ref.path),
      path,
      linkable,
      title: (href) => { const file = path(href); return file ? absoluteWorkspacePath(root, file) : ""; },
      link: (href) => {
        const file = path(href);
        if (file) return () => ask(file);
        const held = href.startsWith(`${GRANTED_FILE}/`) || href.includes(`/${GRANTED_FILE}/`)
          ? decodeURIComponent(href.slice(href.indexOf(GRANTED_FILE)))
          : isLocalPathShape(href) ? grantedFileKey(granted, href) : null;
        return held ? () => ask(held) : null;
      },
      image,
      imageOf: (ref) => port.workspaceImageURL(ref.path, ref.root),
      granted: grantedMark,
      menu: offer,
    };
  }, [port, root, ask, granted]);
  const menuView = shown && menu?.port === port && menu.root === root && <WorkbenchFileMenu key={menu.id} menu={menu} root={root} platform={platform}
    revealable={!remote && port.revealsFiles()} onClose={close}
    onOpen={!remote && port.opensFiles() ? (path) => { void port.openFile(path).catch(fail); } : undefined}
    onReveal={(path) => { void port.revealInFileManager(path).catch(fail); }} />;
  return { refs, request: request?.port === port && request.root === root ? request : undefined, menuView };
}
