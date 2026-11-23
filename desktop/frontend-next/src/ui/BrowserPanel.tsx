import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, MonitorSmartphone, MousePointerClick, RotateCw } from "lucide-react";
import { t } from "../i18n";
import { reason } from "../i18n/kernel";
import type { AgentPort, BrowserTab } from "../port/port";
import { host, type BrowserControl, type BrowserLoadFailure, type BrowserPickEnd, type BrowserRefusal, type PickedElement, type ViewRect } from "../port/host";
import { SWAP_MARK } from "./swap";
import { occluded, visibleBox } from "./occlusion";
import { BrowserSizeBar } from "./BrowserSizeBar";
import { loadSize, saveSize, scaleOf, type Chosen } from "./browserSize";
import { BrowserFailure } from "./BrowserFailure";
import { AgentPageNote } from "./AgentPageNote";
import { readPageTabs } from "./browser_open";
import { pageTitle } from "./workbench_tabs";
import { BrowserElementEdit } from "./BrowserElementEdit";
import type { PageEditor } from "./pageedit";

const START = "reasonix://start";

function normalise(value: string): string | null {
  const raw = value.trim();
  if (!raw) return START;
  if (/^reasonix:\/\//i.test(raw)) return START;
  // This panel frames a web page, and a frame cannot show a file: a path on
  // disk is refused here, never read as a host named by its drive letter.
  if (/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(raw)) return null;
  const local = /^(?:localhost|127(?:\.\d+){3}|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}|\[::1\]|[^./:]+)(?::\d+)?(?:\/|$)/i.test(raw);
  const candidate = local ? `http://${raw}` : /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** What the address field says. A blank page is blank: `about:blank` is the
 *  shell's placeholder for "nothing loaded yet", and `reasonix://start` is this
 *  panel's own opening screen — neither is an address a person typed, so both
 *  read as an empty field rather than as a site named after an internal token.
 *  The tab itself keeps its real url; this is only what the input shows. */
function addressText(url: string | undefined): string {
  const raw = (url ?? "").trim();
  return /^(?:about:blank|reasonix:\/\/start)$/i.test(raw) ? "" : raw;
}

function BrowserStartPage({ scheme }: { scheme: "light" | "dark" }) {
  return <div className="studio-browser-frame studio-browser-start" title={t("workbench.reasonix_built_in_browser")} style={{ colorScheme: scheme }}>
    <div><Globe className="browser-start-mark" size={26} aria-hidden="true" />
      <h1>{t("common.built_in_browser")}</h1>
      <p>{t("workbench.enter_an_address_above_to")}</p>
      <p className="browser-start-hint">{t("workbench.some_sites_do_not_allow")}</p>
    </div>
  </div>;
}

interface ManualProps {
  id: string;
  hidden?: boolean;
  // What the tab should call this one. Several browsers all named 「浏览器」
  // name none of them, and only this panel knows where it has got to.
  onAddress: (id: string, host: string) => void;
  onExternal: (url: string) => void;
  scheme: "light" | "dark";
}

/** FramedPage is the room a page is drawn in. The page keeps its own CSS
 *  pixels — a frame 393 wide answers a phone's media queries because it really
 *  is 393 wide — and this box only decides how much of the panel that frame
 *  takes, centred and never blown up past its own size. */
function FramedPage({ size, children }: { size: Chosen; children: ReactNode }) {
  const room = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = room.current;
    if (!el) return;
    // The room is what is left inside the padding: clientWidth counts the
    // padding the stylesheet puts there, and a scale computed from it draws the
    // frame a padding's worth too tall — which is a scrollbar that scrolls a
    // few pixels over nothing.
    const read = () => {
      const style = getComputedStyle(el);
      const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      setBox({ width: Math.max(0, el.clientWidth - padX), height: Math.max(0, el.clientHeight - padY) });
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = scaleOf(size.mode, box, size);
  // A transform draws the frame smaller without changing the space it takes, so
  // the box that holds it is given the drawn size instead: the room scrolls
  // over what is really on screen, not over the room the page would have had.
  return (
    <div className="studio-browser-canvas" ref={room}>
      <div className="studio-browser-scaled" style={{ width: `${size.width * scale}px`, height: `${size.height * scale}px` }}>
        <div
          className="studio-browser-viewport"
          style={{ width: `${size.width}px`, height: `${size.height}px`, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function ManualBrowserPanel({ id, hidden, onAddress, onExternal, scheme }: ManualProps) {
  const [history, setHistory] = useState([START]);
  const [index, setIndex] = useState(0);
  // `START` is this panel's own opening screen, not an address: it reads as an
  // empty field until something is really loaded.
  const [input, setInput] = useState(addressText(START));
  const [reload, setReload] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(false);
  // The frame is the window's, not this tab's: a size chosen once is where the
  // next page opens too. This panel always frames: it draws the page itself, so
  // there is no other size for it to be.
  const [size, setSize] = useState<Chosen>(() => ({ ...loadSize(), framed: true }));
  const current = history[index] ?? START;
  const internal = current === START;
  useEffect(() => {
    onAddress(id, internal ? "" : new URL(current).hostname);
  }, [id, current, internal, onAddress]);
  useEffect(() => saveSize(size), [size]);

  const visit = (value: string) => {
    // An empty field is a question, not a page: Enter on nothing to go to
    // leaves the panel where it is instead of handing the kernel a blank target.
    // The error goes with it — an empty field is not a refused address, and
    // leaving the red border up would say it was.
    if (!value.trim()) {
      setInvalid(false);
      return;
    }
    const next = normalise(value);
    if (!next) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setLoading(next !== START);
    setInput(addressText(next));
    if (next === current) {
      setReload((value) => value + 1);
      return;
    }
    const nextHistory = history.slice(0, index + 1).concat(next);
    setHistory(nextHistory);
    setIndex(nextHistory.length - 1);
  };

  const move = (next: number) => {
    const value = history[next];
    if (!value) return;
    setIndex(next);
    setInput(addressText(value));
    setInvalid(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    visit(input);
  };

  // Some desktop webviews consume Enter before a form submit bubbles back to
  // React. Commit the address at the field as well; IME confirmation must not
  // navigate while the user is still composing Chinese text.
  const commitAddress = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    visit(event.currentTarget.value);
  };

  return (
    <section className="studio-browser" hidden={hidden} aria-label={t("workbench.built_in_browser")}>
      <form className="studio-browser-toolbar" onSubmit={submit} data-action-submit="browser.navigate">
        <button type="button" data-action="browser.back" onClick={() => move(index - 1)} disabled={index === 0} aria-label={t("workbench.back")} title={t("workbench.back")}>
          <ArrowLeft size={16} />
        </button>
        <button type="button" data-action="browser.forward" onClick={() => move(index + 1)} disabled={index >= history.length - 1} aria-label={t("workbench.forward")} title={t("workbench.forward")}>
          <ArrowRight size={16} />
        </button>
        <button type="button" data-action="browser.reload" onClick={() => setReload((value) => value + 1)} aria-label={t("common.re_freeze")} title={t("common.re_freeze")}>
          <RotateCw size={16} />
        </button>
        <label className="studio-browser-address" data-invalid={invalid ? "" : undefined}>
          <Globe size={16} />
          <input data-action-change="browser.address" data-action-keydown="browser.navigate" value={input} placeholder={t("workbench.enter_address")} onKeyDown={commitAddress} onChange={(event) => { setInput(event.target.value); setInvalid(false); }} aria-label={t("workbench.web_address")} spellCheck={false} autoCapitalize="off" />
        </label>
        <button type="submit" className="studio-browser-go" aria-label={t("workbench.open_page")}>{t("common.open")}</button>
        <button type="button" data-action="browser.external" onClick={() => !internal && onExternal(current)} disabled={internal} aria-label={t("workbench.open_in_external_browser")} title={t("workbench.open_in_external_browser")}>
          <ExternalLink size={16} />
        </button>
      </form>
      <BrowserSizeBar size={size} onChange={setSize} />
      {invalid && <p className="studio-browser-error" role="alert">{t("workbench.enter_a_valid_http_or")}</p>}
      <FramedPage size={size}>
        {internal ? <BrowserStartPage scheme={scheme} /> : <iframe
          key={`${current}:${reload}`}
          className="studio-browser-frame"
          title={t("workbench.reasonix_built_in_browser")}
          src={current}
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
        />}
      </FramedPage>
      {/* Not a hint at an icon somewhere else: a site that refuses to be framed
          shows the shell's own "refused to connect", and the way out has to be
          beside it. */}
      {(loading || !internal) && (
        <footer className="studio-browser-note" data-loading={loading ? "" : undefined}>
          {loading && <span>{t("workbench.opening_page")}</span>}
          {!internal && (
            <button type="button" data-action="browser.external" onClick={() => onExternal(current)}>
              {t("workbench.open_in_external_browser")}
            </button>
          )}
        </footer>
      )}
    </section>
  );
}

// What useBrowserTabs holds before its first read, told apart by identity from a
// read that found no pages.
export const UNREAD_TABS: BrowserTab[] = [];

export function useBrowserTabs(port: AgentPort, moved: number): BrowserTab[] {
  const [tabs, setTabs] = useState<BrowserTab[]>(UNREAD_TABS);
  useEffect(() => {
    let live = true;
    readPageTabs(port).then((next) => live && setTabs(next), () => {});
    return () => { live = false; };
  }, [port, moved]);
  return tabs;
}

export function localFilePath(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "file:" || parsed.host) return "";
  try {
    const path = decodeURIComponent(parsed.pathname);
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return "";
  }
}

type OpenDocument = (path: string) => Promise<void>;

export function AgentBrowserPanel(props: { tabs: BrowserTab[]; shown: boolean; showTabs?: boolean; onOpenDocument?: OpenDocument; editPage?: PageEditor }) {
  if (host().drawsBrowserViews()) return <AgentBrowserView {...props} />;
  const current = props.tabs.find((tab) => tab.active) ?? props.tabs[0];
  return <div className="bpanel">{current && <AgentPageNote tab={current} />}</div>;
}

const PICK_ENDED: Partial<Record<BrowserPickEnd, () => string>> = {
  timeout: () => t("workbench.pick_ended_timeout"),
  hidden: () => t("workbench.pick_ended_hidden"),
  navigation: () => t("workbench.pick_ended_navigation"),
  gone: () => t("workbench.pick_ended_gone"),
};

function AgentBrowserView({ tabs, shown, showTabs = true, onOpenDocument, editPage }: { tabs: BrowserTab[]; shown: boolean; showTabs?: boolean; onOpenDocument?: OpenDocument; editPage?: PageEditor }) {
  const slot = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState("");
  const current = tabs.find((tab) => tab.target === picked) ?? tabs.find((tab) => tab.active) ?? tabs[0];
  const [address, setAddress] = useState(addressText(current?.url));
  const [failures, setFailures] = useState<Record<string, BrowserLoadFailure>>({});
  const [refused, setRefused] = useState<BrowserRefusal>("");
  const [docFailed, setDocFailed] = useState("");
  // The picture the shell answered a freeze with, and the rectangle the view
  // it stands in for stood in — the picture is drawn there, so the swap a
  // freeze makes is not also a jump to another size.
  const [frame, setFrame] = useState<{ picture: string; at: ViewRect | null } | null>(null);
  const [picking, setPicking] = useState(false);
  const [element, setElement] = useState<PickedElement | null>(null);
  const [pickEnd, setPickEnd] = useState("");
  // The size this page is laid out in, when somebody watching it chose one. It
  // travels to the shell rather than to the frame, because the page is a native
  // view: the shell lays it out in that viewport and scales it into the slot.
  // It starts as the panel's own size, which is how an agent's page has always
  // been drawn: as wide as the room, not framed at a window nobody chose.
  const [size, setSize] = useState<Chosen>(() => ({ ...loadSize(), framed: false }));
  // The row is its own state, not a reading of `framed`: choosing the panel's
  // own size lays the page out as wide as the room, and the row stays to say
  // so — only the toggle closes it, which is what the demo showed.
  const [rowOpen, setRowOpen] = useState(false);
  // The placement reads the size and the row, but must not rebuild for them:
  // tearing the effect down hides the view and shows it again half a tick
  // later, which reads as the page blinking every time a number settles.
  // They live in a ref the placement re-reads, and changing them asks for
  // another placement through a ref rather than through a new effect.
  const askedRef = useRef({ size, rowOpen });
  const askPlace = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    askedRef.current = { size, rowOpen };
    askPlace.current();
  }, [size, rowOpen]);
  // Opening the row is asking for a size, so the page is framed at the preset
  // the window remembers — unless the panel's own size was chosen while the
  // row was open, in which case that choice stands until a preset is picked.
  const toggleFrame = () => {
    if (!rowOpen && size.framed === false) setSize((was) => ({ ...was, framed: true }));
    setRowOpen(!rowOpen);
  };
  const target = current?.target ?? "";
  const failure = failures[target];

  useEffect(() => setAddress(addressText(current?.url)), [current?.url, current?.target]);
  useEffect(() => saveSize(size), [size]);
  useEffect(
    () =>
      host().onBrowserLoadState(({ targetId, failure: next }) =>
        setFailures((prev) => {
          if (!next && !prev[targetId]) return prev;
          const out = { ...prev };
          if (next) out[targetId] = next;
          else delete out[targetId];
          return out;
        }),
      ),
    [],
  );
  // A page that did not load is put away, so the reason drawn in its slot is
  // not hidden under the native view. One the page covers is put away too, and
  // its last picture stands in the slot until nothing covers it any more.
  useLayoutEffect(() => {
    const el = slot.current;
    const shell = host();
    setFrame(null);
    if (!el || !shown || !target || failure) {
      shell.hideBrowserView();
      return;
    }
    let timer = 0;
    let live = true;
    // Which frame has been sent to the shell: the poll re-places the page every
    // few hundred milliseconds, and a frame is a debugger command rather than a
    // cheap property write, so it goes only when it changed.
    let sent: { width: number; height: number; zoom?: string } | null | undefined;
    // Which freeze is current: a picture answering an older one is stale.
    let frozen = 0;
    let freezes = 0;
    const place = () => {
      timer = 0;
      const box = visibleBox(el);
      if (!box) {
        frozen = 0;
        shell.hideBrowserView();
        return;
      }
      // What to tell the shell this page is laid out in: a viewport when the
      // row is open and a size is on, and null when it is to be laid out in the
      // rectangle it was given — which is how an agent's page is drawn until
      // somebody says otherwise. The zoom rides with it: the shell scales the
      // frame by it, so a percentage chosen in the row reaches the page.
      const { size, rowOpen } = askedRef.current;
      const want = !rowOpen || size.framed === false ? null : { width: size.width, height: size.height, zoom: size.mode };
      if (document.documentElement.hasAttribute(SWAP_MARK) || occluded(el, box)) {
        if (frozen) return;
        const turn = (frozen = ++freezes);
        void shell.freezeBrowserView().then((shot) => {
          if (!live || frozen !== turn) return;
          // An empty answer is the shell having put the view away itself:
          // nothing stands in for the page, and nothing is left to hide.
          setFrame(shot.picture ? shot : null);
          if (!shot.picture) return;
          // The view goes away only once the picture is on screen: hiding it
          // first left a hole between the two, which read as the page
          // blinking whenever a menu opened over it.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (live && frozen === turn) shell.hideBrowserView();
          }));
        });
        return;
      }
      // A freeze being undone. The picture leaves only once the live view is
      // back over the slot — the show below answers when the shell has put it
      // there, and that answer is what takes the picture away. Cleared here
      // instead, the slot showed its own ground for the frames between the
      // two, which read as the page flashing again when the menu closed.
      // The turn is what keeps a freeze that started again before the view
      // answered from losing a picture that is not its own to take away.
      const unfroze = frozen;
      frozen = 0;
      // The size goes with the rectangle, and before it: the shell lays the
      // page out in that viewport and then fits it into the slot, so a show
      // arriving first would place the page at the slot's own size and then
      // have to move it. A null frame is a state too — the page laid out as
      // the room — so a sent marker says it went out, whatever it was.
      const sameFrame =
        want === null
          ? sent === null
          : sent != null && sent.width === want.width && sent.height === want.height && sent.zoom === want.zoom;
      if (!sameFrame) {
        sent = want;
        shell.frameBrowserView(target, want);
      }
      // The promise stands for the view's answer whatever the bridge hands
      // back — an older shell speaks the verb as void, and undefined has no
      // then to wait on.
      void Promise.resolve(shell.showBrowserView(target, box)).catch(() => {}).then(() => {
        if (live && unfroze && frozen === 0) setFrame(null);
      });
    };
    const schedule = () => { if (!timer) timer = window.setTimeout(place, 48); };
    // A size the row picked, or the row opening or closing, asks for another
    // placement through this ref: the effect above stays standing, so the
    // view is never hidden and shown again for a number that settled.
    askPlace.current = schedule;
    place();
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    const overlays = new MutationObserver(schedule);
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true });
    overlays.observe(document.documentElement, { attributes: true, attributeFilter: [SWAP_MARK, "style", "class"] });
    // A layer can leave without touching the DOM: a transition or an animation
    // ending, a hover, a scroll. The two events catch most of it; the poll is what
    // makes a page that is no longer covered come back whatever moved.
    document.addEventListener("transitionend", schedule, true);
    document.addEventListener("animationend", schedule, true);
    addEventListener("resize", schedule);
    const poll = window.setInterval(schedule, 400);
    return () => {
      live = false;
      // A placement asked for after this effect is gone would speak for a view
      // nobody is looking at, so the door the ref opens is shut behind it.
      askPlace.current = () => {};
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      resize.disconnect();
      overlays.disconnect();
      document.removeEventListener("transitionend", schedule, true);
      document.removeEventListener("animationend", schedule, true);
      removeEventListener("resize", schedule);
      shell.hideBrowserView();
    };
  }, [shown, target, failure]);

  // A pick belongs to the page it was armed on: another page, or another
  // address on the same one, leaves it nothing to point at.
  useEffect(() => {
    setElement(null);
    setPickEnd("");
    if (!picking) return;
    setPicking(false);
    if (target) host().cancelBrowserPick(target);
  }, [target, current?.url]);
  const pick = () => {
    if (!target) return;
    if (picking) {
      host().cancelBrowserPick(target);
      return;
    }
    setPicking(true);
    setPickEnd("");
    const armed = target;
    void host()
      .pickBrowserElement(armed, {
        color: t("workbench.edit_color"),
        background: t("workbench.edit_background"),
        font: t("workbench.edit_font_size"),
        frame: t("workbench.pick_ended_gone"),
        shadow: t("workbench.pick_ended_gone"),
      })
      .then((answer) => {
        setPicking(false);
        if (answer.cancelled) {
          setPickEnd(PICK_ENDED[answer.reason]?.() ?? "");
          return;
        }
        setElement(answer.element);
      });
  };
  const control = (action: BrowserControl) => target && host().controlBrowserView(target, action);
  const open = (to: string) => {
    if (!target) return;
    void host()
      .navigateBrowserView(target, to)
      .then(setRefused);
  };
  const documentPath = onOpenDocument ? localFilePath(current?.url ?? "") : "";
  useEffect(() => setDocFailed(""), [current?.url]);
  const openDocument = () => {
    if (!documentPath || !onOpenDocument) return;
    setDocFailed("");
    onOpenDocument(documentPath).catch((e) => setDocFailed(reason(e)));
  };
  const go = (event: FormEvent) => {
    event.preventDefault();
    // A blank field is a question, not a page. `about:blank` reads as empty in
    // this field now, so Enter with nothing typed must not navigate the view to
    // an empty target — it leaves the page where it is.
    if (!address.trim()) return;
    open(address);
  };
  return (
    <div className="bpanel">
      <div className="bbar">
        {showTabs && <div className="vtabs" role="tablist">
          {tabs.map((tab) => (
            <button key={tab.target} className="tab btab" role="tab" data-action="browser.tab" data-target={tab.id} aria-selected={tab.target === target} title={tab.url} onClick={() => setPicked(tab.target)}>
              {pageTitle(tab)}
            </button>
          ))}
        </div>}
        <div className="bnav">
          <button className="bbtn" data-action="browser.control" data-target={current?.id} data-value="back" aria-label={t("workbench.back")} title={t("workbench.back")} onClick={() => control("back")}><ArrowLeft size={16} /></button>
          <button className="bbtn" data-action="browser.control" data-target={current?.id} data-value="forward" aria-label={t("workbench.forward")} title={t("workbench.forward")} onClick={() => control("forward")}><ArrowRight size={16} /></button>
          <button className="bbtn" data-action="browser.control" data-target={current?.id} data-value="reload" aria-label={t("common.reload")} title={t("common.reload")} onClick={() => control("reload")}><RotateCw size={16} /></button>
          <form className="baddr" data-action="browser.navigate" data-target={current?.id} onSubmit={go}>
            <input data-action="browser.navigate" data-target={current?.id} value={address} placeholder={t("workbench.enter_address")} spellCheck={false} aria-label={t("workbench.address")} onChange={(event) => { setAddress(event.target.value); setRefused(""); }} />
          </form>
          <button className="bbtn" data-action="browser.free-size" aria-pressed={rowOpen} aria-label={t("workbench.free_size")} title={t("workbench.free_size")} onClick={toggleFrame}><MonitorSmartphone size={16} /></button>
          {host().picksBrowserElements() && (
            <button className="bbtn" data-action="browser.pick" aria-pressed={picking} disabled={!target || !!failure} aria-label={t("workbench.pick_element")} title={t("workbench.pick_element")} onClick={pick}><MousePointerClick size={16} /></button>
          )}
          <button className="bbtn" data-action="browser.external" disabled={!documentPath && !/^https?:\/\//i.test(current?.url ?? "")} aria-label={documentPath ? t("workbench.open_this_file_with_the") : t("workbench.open_this_page_in_the")} title={documentPath ? t("workbench.open_this_file_with_the") : t("workbench.open_this_page_in_the")} onClick={() => (documentPath ? openDocument() : current && void host().openExternal(current.url))}><ExternalLink size={16} /></button>
        </div>
      </div>
      {rowOpen && <BrowserSizeBar size={size} onChange={setSize} panel />}
      {documentPath && <p className="studio-browser-note" data-action="browser.document-hint">{t("workbench.opens_this_file_with_the")}</p>}
      {docFailed && <p className="studio-browser-error" role="alert">{docFailed}</p>}
      {picking && <p className="studio-browser-note" role="status">{t("workbench.picking_element")}</p>}
      {pickEnd && <p className="studio-browser-note" role="status">{pickEnd}</p>}
      {element && (
        <BrowserElementEdit
          key={element.selector}
          element={element}
          filePath={localFilePath(current?.url ?? "")}
          editor={editPage}
          onSaved={() => control("reload")}
          onClose={() => setElement(null)}
        />
      )}
      {refused && (
        <p className="studio-browser-error" role="alert">
          {refused === "network_file" ? t("workbench.a_network_share_cannot_be") : t("workbench.enter_a_valid_http_or")}
        </p>
      )}
      <div className="bview" ref={slot}>
        {failure ? (
          <BrowserFailure
            failure={failure}
            onRetry={() => open(failure.url)}
            onExternal={() => host().openExternal(failure.url)}
            onTrust={() => void host().trustBrowserCertificate(target)}
          />
        ) : (
          frame && (
            <img
              className="bframe"
              src={frame.picture}
              alt=""
              draggable={false}
              style={frame.at ? { left: frame.at.x, top: frame.at.y, width: frame.at.width, height: frame.at.height } : undefined}
            />
          )
        )}
      </div>
    </div>
  );
}

export function BrowserPanel(props: ManualProps | { tabs: BrowserTab[]; shown: boolean; onOpenDocument?: OpenDocument; editPage?: PageEditor }) {
  return "tabs" in props ? <AgentBrowserPanel {...props} /> : <ManualBrowserPanel {...props} />;
}
