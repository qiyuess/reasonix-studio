import type { SVGProps } from "react";
import { createLucideIcon } from "lucide-react";
import {
  Activity, Archive, ArrowDown, ArrowRight, ArrowUp, Ban, BarChart3, BookOpen, Bookmark, Bot, Brain,
  Check, ChevronDown, ChevronRight, ChevronUp, Circle, CircleCheck, CircleDashed, CircleHelp,
  CirclePlay, CircleX, Clock, CodeXml, Coins, Copy, Download, Eclipse, Ellipsis, Eraser,
  ExternalLink, Eye, EyeOff, FileCode, FilePenLine, FileSearch, FileText, Folder, FolderInput,
  FolderOpen, Galaxy, GitBranch, GitFork, Globe, HardDrive, History, Image, Info, Keyboard,
  Layers, LayoutGrid, Link, List, ListChecks, LoaderCircle, Lock, Maximize2, Menu, MessageCircle,
  MessageSquare, MessageSquareText, Minimize2, Minus, Monitor, Moon, Network, NotebookPen, Package,
  Palette, PanelLeft, PanelLeftClose, PanelLeftOpen, PanelRight, Pause, Pencil, Pin, Play, Plug,
  Plus, QrCode, Quote, Regex, Repeat, RotateCcw, RotateCw, Search, Send, Server, Settings, Shield,
  ShieldCheck, SlidersHorizontal, Smartphone, Sparkle, Sparkles, Square, SquareCheck, Star, Sun,
  Target, Terminal, ThumbsDown, ThumbsUp, Trash2, TriangleAlert, Type, Upload, UserRound,
  Volume2, VolumeX, Wallet, Wrench, X, ZoomIn, ZoomOut, Zap,
} from "lucide-react";

const ICONS = {
  folder: Folder, reveal: FolderOpen, file: FileText, image: Image, send: Send, fail: CircleX,
  search: Search, chevron: ChevronRight, down: ChevronDown, up: ChevronUp, minus: Minus,
  brain: Brain, plus: Plus, arrow: ArrowUp, arrowDown: ArrowDown, arrowRight: ArrowRight,
  close: X, expand: Maximize2, collapseAll: Minimize2, expandAll: Maximize2, check: Check,
  globe: Globe, code: CodeXml, settings: Settings, sliders: SlidersHorizontal, more: Ellipsis,
  menu: Menu, panel: PanelLeft, panelClose: PanelLeftClose, panelOpen: PanelLeftOpen,
  panelRight: PanelRight, lock: Lock, shield: Shield, shieldCheck: ShieldCheck,
  branch: GitBranch, fork: GitFork, layers: Layers, spark: Sparkle, agent: Bot,
  refresh: RotateCw, sparkle: Star, target: Target, terminal: Terminal, eraser: Eraser,
  clock: Clock, stop: Square, play: Play, pause: Pause, bolt: Zap, coin: Coins,
  info: Info, warning: TriangleAlert, copy: Copy, quote: Quote, external: ExternalLink,
  plug: Plug, download: Download, upload: Upload, chat: MessageSquare, list: List,
  edit: Pencil, rewind: RotateCcw, pin: Pin, trash: Trash2, archive: Archive, server: Server,
  link: Link, feedback: MessageSquareText, wallet: Wallet, eye: Eye, eyeoff: EyeOff,
  activity: Activity, chart: BarChart3, book: BookOpen, bookmark: Bookmark, question: CircleHelp,
  circle: Circle, circleDashed: CircleDashed, fading: Eclipse, complete: SquareCheck,
  success: CircleCheck, running: CirclePlay, inactive: Circle, loading: LoaderCircle,
  fileCode: FileCode, fileEdit: FilePenLine, fileSearch: FileSearch, moveFile: FolderInput,
  history: History, storage: HardDrive, keyboard: Keyboard, grid: LayoutGrid, monitor: Monitor,
  sun: Sun, moon: Moon, network: Network, notebook: NotebookPen, package: Package,
  palette: Palette, repeat: Repeat, galaxy: Galaxy, phone: Smartphone, qr: QrCode, user: UserRound,
  tasks: ListChecks, tools: Wrench, magic: Sparkles, comment: MessageCircle, matchCase: Type,
  regex: Regex, thumbsUp: ThumbsUp, thumbsDown: ThumbsDown, volume: Volume2, muted: VolumeX,
  zoomIn: ZoomIn, zoomOut: ZoomOut, disabled: Ban,
} as const;

/** The full-workbench toggle's glyph, the demo's own: four rounded corner
 *  brackets around a small rounded square — the square is the room the
 *  toggle answers with, where the free-size control beside it asks for a
 *  size. Lucide's `scan` draws the brackets tighter and its square larger;
 *  these are the demo's exact paths, and the toggle draws them at the
 *  demo's stroke of 2 rather than the icons' 1.8. */
const ScanFrame = createLucideIcon("ScanFrame", [
  ["path", { d: "M4 8V6a2 2 0 0 1 2-2h2", key: "a" }],
  ["path", { d: "M16 4h2a2 2 0 0 1 2 2v2", key: "b" }],
  ["path", { d: "M20 16v2a2 2 0 0 1-2 2h-2", key: "c" }],
  ["path", { d: "M8 20H6a2 2 0 0 1-2-2v-2", key: "d" }],
  ["rect", { x: "8.5", y: "8.5", width: "7", height: "7", rx: "1.5", key: "e" }],
]);

const ALL = { ...ICONS, scanFrame: ScanFrame } as const;

export type StudioIconName = keyof typeof ALL;

export function StudioIcon({ name, className, ...props }: SVGProps<SVGSVGElement> & { name: StudioIconName }) {
  const Icon = ALL[name];
  return <Icon className={["studio-icon", className].filter(Boolean).join(" ")} size={16} strokeWidth={1.8} aria-hidden="true" focusable="false" {...props} />;
}
