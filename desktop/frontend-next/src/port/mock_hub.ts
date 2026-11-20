import type { AgentPort } from "./port";
import type { HistorySearch, HubPort, RuntimeView, TreeSession, TreeWindow, TreeWorkspace } from "./hub";
import type { RemoteHost, RemoteListing, RemoteProbe } from "./remote";
import type { OfferChannel, PhoneAction, PhoneList, PhoneView, ShareStatus } from "./share";
import { AUTO_WORKSPACE, MockPort } from "./mock";
import { HttpError } from "./http_error";

// MockHub is the fixture's answer to a window that drives several panes. Each
// pane gets its own scripted session, so the split view can be worked on
// without a kernel — the dev build's only reason to exist.
export class MockHub implements HubPort {
  private readonly ports = new Map<string, AgentPort>();
  private readonly machine = { configured: false };
  private readonly settings = new MockPort();
  private readonly remoteSettings = new Map<string, MockPort>();
  private readonly views: RuntimeView[];
  private readonly seeded: TreeSession[];
  private readonly roots = ["~/projects/DeepSeek-Reasonix", "~/projects/my-website"];
  private seq: number;
  private readonly flags = new Map<string, Pick<TreeSession, "pinned" | "archived" | "unread">>();

  constructor(panes = 1) {
    this.seeded = panes > 1 ? Array.from({ length: panes }, (_, i) => ({
      path: `/sessions/pane-${i + 1}.jsonl`, name: `pane-${i + 1}`, title: `并行会话 ${i + 1}`, turns: 3,
    })) : [];
    const initial = panes === 1 ? [{ path: "/sessions/mock.jsonl" }] : this.seeded;
    this.views = initial.map((session, i) => ({
      id: `r${i + 1}`, base: i === 0 ? "" : `/rt/r${i + 1}`, root: this.roots[0],
      name: "DeepSeek-Reasonix", sessionPath: session.path,
    }));
    this.seq = this.views.length;
  }

  private decorate(tree: TreeWorkspace[], host = ""): TreeWorkspace[] {
    return tree.map((ws) => ({ ...ws, sessions: ws.sessions.map((session) => ({ ...session,
      ...this.flags.get(JSON.stringify([host, session.path])) })) }));
  }

  runtimes() {
    return Promise.resolve([...this.views]);
  }

  async open(req: { root?: string; sessionPath?: string; agentComposition?:string; noProject?: boolean }) {
    const held = req.sessionPath ? this.views.find((v) => v.sessionPath === req.sessionPath) : undefined;
    if (held) return Promise.resolve(held);
    this.seq++;
    // A pane with no project joins the app's own folder, exactly as
    // {auto:true} answers — a folder the project tree never lists.
    const root = req.noProject ? AUTO_WORKSPACE : (req.root || this.roots[0]);
    const view: RuntimeView = {
      id: `r${this.seq}`,
      base: `/rt/r${this.seq}`,
      root,
      name: root.split("/").pop() ?? root,
      sessionPath: req.sessionPath,
      noProject: req.noProject || undefined,
    };
    const port=this.portFor(view);
    if (req.agentComposition) await port.selectAgentComposition(req.agentComposition);
    view.agentComposition=await port.agentComposition() ?? undefined;
    this.views.push(view);
    return Promise.resolve(view);
  }

  // Two machines, one of them mid-connect: the fixture has to show the step
  // list and the pip states without a kernel, or neither gets designed.
  remoteHosts() {
    return Promise.resolve<RemoteHost[]>([
      {
        name: "gpu-box",
        target: "ada@10.0.0.4",
        workspace: "/srv/training",
        // A machine with more than one project on it, which is the shape the
        // sidebar has to draw and the one a single field could not.
        workspaces: ["/srv/training", "/srv/eval", "/home/ada/notes"],
        status: "connected",
        panes: 1,
      },
      { name: "builder", target: "ada@build.internal", workspace: "~/work", workspaces: ["~/work"], status: "connecting", step: "install", detail: "npm" },
      { name: "spare", target: "10.0.0.9", status: "idle" },
    ]);
  }

  // The fixture's own far machine: one workspace with a conversation in it, so
  // the tree under a connected host can be designed without one.
  remoteTree(host: string, window?: TreeWindow) {
    if (host !== "gpu-box") return Promise.resolve(null);
    return Promise.resolve<TreeWorkspace[]>(this.recentTree(this.decorate([
      {
        root: "/srv/training",
        name: "training",
        sessions: [
          { path: "/srv/sessions/pipeline.jsonl", name: "pipeline", title: "数据管线", turns: 7, lastActiveAt: Date.now() - 2 * 3_600_000 },
          { path: "/srv/sessions/eval.jsonl", name: "eval", title: "跑一遍评测", turns: 2, lastActiveAt: Date.now() - 7 * 86_400_000 },
        ],
      },
      { root: "/srv/scratch", name: "scratch", sessions: [] },
    ], host), window));
  }

  async openRemote(req: { host: string; workspace?: string; sessionPath?: string; agentComposition?: string }) {
    this.seq++;
    const workspace = req.workspace || "/srv/training";
    const view: RuntimeView = {
      id: `r${this.seq}`,
      base: `/rt/r${this.seq}`,
      root: workspace,
      name: workspace.split("/").pop() ?? workspace,
      host: req.host,
      sessionPath: req.sessionPath,
    };
    const port = this.portFor(view);
    if (req.agentComposition) await port.selectAgentComposition(req.agentComposition);
    view.agentComposition = await port.agentComposition() ?? undefined;
    this.views.push(view);
    return Promise.resolve(view);
  }

  // A far machine's filesystem, deep enough that walking down and back up can
  // be designed: the picker's two hard states are a folder with nothing in it
  // and one with more than fits.
  // A machine with no npm and nothing uploadable: the interesting shape, since
  // a ready one has nothing to show.
  async probeRemote(_host: string): Promise<RemoteProbe> {
    return {
      os: "linux",
      arch: "amd64",
      home: "/home/ada",
      ready: false,
      routes: [
        { name: "npm", ok: false, code: "remote.npm_unavailable" },
        { name: "upload", ok: false, code: "remote.platform_mismatch" },
        { name: "download", ok: true },
      ],
    };
  }

  remoteDirs(_host: string, path?: string) {
    const at = path || "/home/ada";
    const kids: Record<string, string[]> = {
      "/": ["home", "srv", "var"],
      "/home": ["ada"],
      "/home/ada": [".config", "notes", "projects"],
      "/home/ada/projects": ["pipeline", "site"],
      "/srv": ["eval", "private", "training"],
    };
    const folders = (kids[at] ?? []).map((name) => ({ name, path: at === "/" ? "/" + name : at + "/" + name }));
    return Promise.resolve<RemoteListing>({
      path: at,
      parent: at === "/" ? undefined : at.slice(0, at.lastIndexOf("/")) || "/",
      folders,
      unlisted: at === "/srv/private" || undefined,
    });
  }

  addRemoteWorkspace() {
    return Promise.resolve();
  }

  removeRemoteWorkspace() {
    return Promise.resolve();
  }

  saveRemoteHost() {
    return Promise.resolve();
  }

  removeRemoteHost() {
    return Promise.resolve();
  }

  placeRemoteHost() {
    return Promise.resolve();
  }

  remoteCandidates() {
    return Promise.resolve(["attic", "old-laptop"]);
  }

  wslDistros() {
    return Promise.resolve({ available: true, distros: [{ name: "Ubuntu-24.04", version: 2, default: true }, { name: "Debian", version: 2 }, { name: "Alpine-legacy", version: 1 }] });
  }

  // The fixture has no link to block, so nothing ever asks. The dialog is
  // driven from a story instead of from a stub that would fire on load.
  onRemoteAsk() {
    return () => {};
  }

  answerRemote() {}

  close(id: string) {
    const at = this.views.findIndex((v) => v.id === id);
    if (at >= 0) this.views.splice(at, 1);
    this.ports.delete(id);
    return Promise.resolve();
  }

  onTreeChanged(_listener: () => void) { return () => {}; }

  tree(window?: TreeWindow) {
    const open = new Map(this.views.filter((v) => v.sessionPath).map((v) => [v.sessionPath!, v.id]));
    return Promise.resolve(
      this.recentTree(this.decorate(this.roots.map<TreeWorkspace>((root, i) => ({
        root,
        name: root.split("/").pop() ?? root,
        open: this.views.some((v) => v.root === root),
        remembered: true,
        sessions: this.placed(root,
          i === 0
            ? this.seeded.length ? this.seeded.map((session) => ({ ...session, runtimeId: open.get(session.path) })) : [
                { path: "/sessions/mock.jsonl", name: "mock", title: "并行会话演示", turns: 3, runtimeId: open.get("/sessions/mock.jsonl") },
                { path: "/sessions/older.jsonl", name: "older", title: "上一次的会话", turns: 12, runtimeId: open.get("/sessions/older.jsonl"), legacy: true, lastActiveAt: Date.now() - 86_400_000 },
              ]
            : [{ path: "/sessions/site.jsonl", name: "site", title: "站点改版", turns: 5, runtimeId: open.get("/sessions/site.jsonl"), lastActiveAt: Date.now() - 2 * 3_600_000 }]),
      }))), window),
    );
  }

  protected recentTree(tree: TreeWorkspace[], window?: TreeWindow): TreeWorkspace[] {
    if (window?.order !== "recent") return tree;
    const q = window.q?.trim().toLowerCase() || "";
    const rows = tree.flatMap((ws, workspace) => ws.sessions
      .filter((session) => !session.archived && !(window.hideLegacy && !q && session.legacy) &&
        (!q || ws.name.toLowerCase().includes(q) || (session.title || session.name).toLowerCase().includes(q)))
      .map((session) => ({ workspace, session })))
      .sort((a, b) => (b.session.lastActiveAt ?? 0) - (a.session.lastActiveAt ?? 0) || (a.session.path < b.session.path ? -1 : a.session.path > b.session.path ? 1 : 0));
    const offset = window.offset ?? 0;
    const end = window.limit === 0 ? rows.length : offset + (window.limit ?? 50);
    return tree.map((ws, workspace) => ({ ...ws, recentOffset: offset,
      remaining: rows.slice(end).filter((row) => row.workspace === workspace).length,
      sessions: rows.slice(offset, end).filter((row) => row.workspace === workspace).map((row) => row.session),
    }));
  }

  addWorkspace(path: string) {
    if (!this.roots.includes(path)) this.roots.push(path);
    return Promise.resolve<TreeWorkspace>({ root: path, name: path.split("/").pop() ?? path, remembered: true, sessions: [] });
  }

  async revealWorkspace() {}

  async openWorkspace() {}

  async openWithTargets() {
    return [{ id: "vscode", name: "Visual Studio Code", available: true }, { id: "terminal", name: "Terminal", available: true }];
  }

  async openWith() {}

  removeWorkspace(path: string) {
    const at = this.roots.indexOf(path);
    if (at >= 0) this.roots.splice(at, 1);
    return Promise.resolve();
  }

  // Where the person placed sessions, by workspace: what the kernel keeps per project.
  protected placedSessions = new Map<string, string[]>();
  protected names = new Map<string, string>();
  protected pinnedRoots = new Set<string>();

  protected placed(root: string, sessions: TreeSession[]): TreeSession[] {
    const order = this.placedSessions.get(root) ?? [];
    const rank = (s: TreeSession) => order.indexOf(s.path);
    return [...sessions].sort((a, b) => rank(a) - rank(b));
  }

  async moveSession(path: string, direction: -1 | 1) {
    const ws = (await this.tree()).find((w) => w.sessions.some((s) => s.path === path));
    if (!ws) return;
    const order = ws.sessions.map((s) => s.path);
    const at = order.indexOf(path);
    const to = at + direction;
    if (to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
    this.placedSessions.set(ws.root, order);
  }

  moveWorkspace(path: string, direction: -1 | 1) {
    const at = this.roots.indexOf(path);
    const to = at + direction;
    if (at >= 0 && to >= 0 && to < this.roots.length) {
      [this.roots[at], this.roots[to]] = [this.roots[to], this.roots[at]];
    }
    return Promise.resolve();
  }

  searchHistory(_query: string): Promise<HistorySearch> {
    return Promise.resolve({ hits: [], index: { state: "ready", indexed: 0, total: 0, failed: 0, partial: false } });
  }

  placeWorkspace(path: string, before: string) {
    const at = this.roots.indexOf(path);
    if (at < 0) return Promise.resolve();
    this.roots.splice(at, 1);
    const to = before ? this.roots.indexOf(before) : this.roots.length;
    this.roots.splice(to < 0 ? this.roots.length : to, 0, path);
    return Promise.resolve();
  }

  // Put one conversation before another inside its folder.
  placeSession(path: string, before: string) {
    const ws = this.roots.map((root) => root).find((root) => (this.placedSessions.get(root) ?? []).includes(path));
    const root = ws ?? this.roots.find((r) => r === path.split("/").slice(0, -1).join("/"));
    if (!root) return Promise.resolve();
    const order = [...(this.placedSessions.get(root) ?? [])].filter((p) => p !== path);
    const at = before ? order.indexOf(before) : order.length;
    order.splice(at < 0 ? order.length : at, 0, path);
    this.placedSessions.set(root, order);
    return Promise.resolve();
  }

  setWorkspaceDisplayName(path: string, name: string) {
    this.names.set(path, name);
    return Promise.resolve();
  }

  setWorkspacePinned(path: string, pinned: boolean) {
    if (pinned) this.pinnedRoots.add(path);
    else this.pinnedRoots.delete(path);
    return Promise.resolve();
  }

  // The fixture's project archive has to reach every conversation of the folder,
  // not the rows one page happened to carry: that reach is the whole point of
  // the kernel doing it.
  async archiveWorkspace(path: string, archived: boolean) {
    for (const ws of await this.tree()) {
      if (ws.root !== path) continue;
      for (const session of ws.sessions) {
        const key = JSON.stringify(["", session.path]);
        this.flags.set(key, { ...this.flags.get(key), archived, ...(archived ? { pinned: false } : {}) });
      }
    }
  }

  moveSessionTo(path: string, target: string) {
    return Promise.resolve({ path: `${target}/${path.split("/").pop()}`, originalRemoved: true });
  }

  removeSession(_path: string) {
    return Promise.resolve();
  }

  removeRemoteSession(_host: string, _path: string) {
    return Promise.resolve();
  }

  archiveSession(path: string, archived: boolean, host = "") {
    const key = JSON.stringify([host, path]);
    this.flags.set(key, { ...this.flags.get(key), archived, ...(archived ? { pinned: false } : {}) });
    return Promise.resolve();
  }

  pinSession(path: string, pinned: boolean, host = "") {
    const key = JSON.stringify([host, path]);
    this.flags.set(key, { ...this.flags.get(key), pinned });
    return Promise.resolve();
  }

  markSessionRead(path: string, host = "") {
    const key = JSON.stringify([host, path]);
    this.flags.set(key, { ...this.flags.get(key), unread: false });
    return Promise.resolve();
  }

  syncPins(_paths: string[]) {
    return Promise.resolve();
  }

  renameSession(_path: string, _title: string) {
    return Promise.resolve();
  }

  autoNameSession(_path: string) {
    return Promise.resolve({ title: "最近的聊天话题" });
  }

  exportSession(path: string) {
    const name = path.split(/[/\\]/).at(-1)?.replace(/\.jsonl$/i, "") || "session";
    return Promise.resolve({ name, content: '{"role":"user","content":"mock session"}\n' });
  }

  importLegacySessions(_path: string, _workspace: string) {
    return Promise.resolve({ summary: "mock migration complete", imported: 0, warnings: 0, recognised: true, skipped: [] });
  }

  importNativeSession(_file: Blob, _workspace: string) {
    return Promise.resolve({ path: `/sessions/imported-${++this.seq}.jsonl` });
  }

  hostCapabilities() {
    return Promise.resolve({ pickFolder: true, addWorkspace: true });
  }

  pickFolder() {
    return Promise.resolve<string | null>("~/projects/mock-workspace");
  }

  private share: ShareStatus = {
    open: false,
    addresses: [
      { interface: "Wi-Fi", ip: "192.168.1.20", kind: "lan" },
      { interface: "Tailscale", ip: "100.101.7.3", kind: "tailnet" },
      { interface: "vEthernet (WSL)", ip: "172.28.160.1", kind: "virtual" },
    ],
    devices: [],
    cloudDevices: [],
    cloudRemote: { online: false, reason: "signed_out" },
  };

  private phones: PhoneView[] = [
    { id: "rc_aaa", ordinal: 1, name: "iPhone Safari", state: "active", uaClass: "ios-safari", createdAt: "2026-10-12T08:00:00Z", lastSeenAt: "2026-10-18T09:30:00Z", keyThumbprint: "kP3x…f9a1" },
    { id: "rc_bbb", name: "Android Chrome", state: "pending", uaClass: "android-chrome", createdAt: "2026-10-18T09:40:00Z", lastSeenAt: "2026-10-18T09:40:00Z", expiresAt: "2026-10-18T09:55:00Z", keyThumbprint: "Zq8m…02c7" },
  ];

  sharePhones() {
    return Promise.resolve<PhoneList | null>({ phones: this.phones.map((p) => ({ ...p })) });
  }

  resolvePhone(id: string, action: PhoneAction) {
    this.phones = this.phones.flatMap((p) => (p.id !== id ? [p] : action === "reject" ? [] : [{ ...p, state: "active" as const, expiresAt: undefined, ordinal: 2 }]));
    return Promise.resolve<PhoneList>({ phones: this.phones.map((p) => ({ ...p })) });
  }

  revokePhone(id: string) {
    this.phones = this.phones.filter((p) => p.id !== id);
    return Promise.resolve<PhoneList>({ phones: this.phones.map((p) => ({ ...p })) });
  }

  shareStatus() {
    return Promise.resolve<ShareStatus | null>({ ...this.share });
  }

  openShare(ip: string) {
    // The proxy's door opens beside the phone's, exactly as the kernel does it:
    // a configured name becomes the address the proxy channel answers at.
    this.share = {
      ...this.share,
      open: true,
      origin: `http://${ip}:${this.share.port ?? 41234}`,
      proxyOrigin: this.share.publicOrigin,
      devices: [],
    };
    return Promise.resolve({ ...this.share });
  }

  setSharePort(port: number) {
    this.share = { ...this.share, port: port || undefined };
    return Promise.resolve({ ...this.share });
  }

  setSharePublicOrigin(origin: string) {
    this.share = { ...this.share, publicOrigin: origin || undefined };
    return Promise.resolve({ ...this.share });
  }

  private remember = false;

  shareRemember() {
    return Promise.resolve<{ remember: boolean } | null>({ remember: this.remember });
  }

  setShareRemember(remember: boolean) {
    this.remember = remember;
    return Promise.resolve({ remember: this.remember });
  }

  closeShare() {
    // A shut share has no doors, so it has no proxy channel either: the kernel
    // reports the proxy's address only while the door it names is up. Leaving
    // the name behind made a shut share look like one with a proxy still
    // answering on it.
    this.share = { ...this.share, open: false, origin: undefined, proxyOrigin: undefined, devices: [], offerExpires: undefined };
    return Promise.resolve({ ...this.share });
  }

  offerShare(channel: OfferChannel = "lan", link = false) {
    // The three refusals the kernel makes, so a fixture cannot show a door this
    // machine does not have: a shut share has no door at all, a proxy's door
    // exists only once a name is configured, and a local door opened on loopback
    // is one no phone dials. The last one used to be missing here, so a fixture
    // on a machine with no reachable adapter still handed out a working-looking
    // link the kernel would refuse.
    if (!this.share.open) {
      return Promise.reject(new HttpError(409, "sharing is off", { code: "share.closed" }));
    }
    if (channel === "proxy" && !this.share.proxyOrigin) {
      return Promise.reject(new HttpError(409, "this share has no door by that name", { code: "share.channel_unknown" }));
    }
    if (channel !== "proxy" && !this.share.addresses.some((a) => a.kind !== "loopback")) {
      return Promise.reject(new HttpError(409, "this share has no door by that name", { code: "share.channel_unknown" }));
    }
    const expires = new Date(Date.now() + 5 * 60_000).toISOString();
    // A link code lives beside the symbol rather than replacing it, so it leaves
    // the status — and the picture the status says is on offer — alone.
    if (!link) this.share = { ...this.share, offerExpires: expires };
    const qr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path fill="#000" d="M4 4h7v7h-7zM18 4h7v7h-7zM4 18h7v7h-7zM13 13h3v3h-3z"/></svg>`;
    const base = channel === "proxy" ? this.share.proxyOrigin : this.share.origin;
    return Promise.resolve({ channel, url: `${base}/#pair=${link ? "mock-link-code" : "mock-code"}`, qr, expires });
  }

  offerCloudShare() {
    const qr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path fill="#000" d="M4 4h7v7h-7zM18 4h7v7h-7zM4 18h7v7h-7zM13 13h3v3h-3z"/></svg>`;
    return Promise.resolve({ url: "https://reasonix.io/remote/?device=mock-device", qr });
  }

  device() {
    return Promise.resolve(null);
  }

  leaveDevice() {
    return Promise.resolve();
  }

  revokeDevice(id: string) {
    this.share = {
      ...this.share,
      devices: this.share.devices.filter((d) => d.id !== id),
      cloudDevices: this.share.cloudDevices.filter((d) => d.id !== id),
    };
    return Promise.resolve({ ...this.share });
  }

  machinePort(runtimeId?: string): AgentPort {
    const local = this.views.find((rt) => rt.id === runtimeId && !rt.host);
    if (local) return this.portFor(local);
    this.settings.machine = this.machine;
    return this.settings;
  }

  portFor(rt: RuntimeView): AgentPort {
    const held = this.ports.get(rt.id);
    if (held) return held;
    const port = new MockPort();
    let settings = this.settings;
    if (rt.host) {
      settings = this.remoteSettings.get(rt.host) ?? new MockPort();
      this.remoteSettings.set(rt.host, settings);
    }
    port.shareAgentPresetsFrom(settings,rt.root);
    port.machine = this.machine;
    this.ports.set(rt.id, port);
    return port;
  }
}
