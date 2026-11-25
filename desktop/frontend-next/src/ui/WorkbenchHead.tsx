import type { KeyboardEvent, MouseEvent, RefObject } from "react";
import { t } from "../i18n";
import type { WorkspaceChange } from "../port/port";
import { BrowserFullToggle } from "./BrowserFullToggle";
import { StudioIcon } from "./StudioIcon";
import { TooltipButton } from "./TooltipButton";
import { leave } from "./workbench_motion";
import { keyOf, type Surface } from "./workbench_tabs";
import { WorkbenchTabIcon } from "./WorkbenchTabIcon";
import { WorkbenchTabPicker } from "./WorkbenchTabPicker";

export interface WorkbenchHeadProps {
  surfaces: Surface[];
  labelFor: (surface: Surface) => string;
  active: Surface | undefined;
  activeKey: string;
  launcher: boolean;
  showFiles: boolean;
  closing: boolean;
  renaming: string;
  unsaved: string[];
  entering: ReadonlySet<string>;
  changes: WorkspaceChange[];
  tabMenuKey: string | null;
  strip: RefObject<HTMLDivElement | null>;
  newTab: RefObject<HTMLButtonElement | null>;
  pick: (key: string) => void;
  toggleLauncher: () => void;
  toggleExplorer: () => void;
  offerTabMenu: (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, surface: Surface) => void;
  setRenaming: (key: string) => void;
  nameTab: (surface: Surface, name: string) => void;
  onClose: (targets: Surface[]) => void;
  setAsking: (asking: { path: string; anchor: HTMLElement } | null) => void;
  fullMode: { full: boolean; onToggle: () => void } | null | undefined;
}

export function WorkbenchHead({
  surfaces, labelFor, active, activeKey, launcher, showFiles, closing, renaming, unsaved,
  entering, changes, tabMenuKey, strip, newTab, pick, toggleLauncher, toggleExplorer,
  offerTabMenu, setRenaming, nameTab, onClose, setAsking, fullMode,
}: WorkbenchHeadProps) {
  return (
    <header className="workbench-tabs">
      {/* Every open tab in one list, to jump from, at the very head of the row —
          before the file tree. The tree opens a new tab; this one reaches the
          tabs already open, including the ones a narrow strip has scrolled out
          of sight, which is what the row could not do on its own. Drawn whether
          or not anything is hidden: a strip that fits today does not once two
          files are opened beside it. */}
      <WorkbenchTabPicker
        tabs={surfaces.map((surface) => ({ key: keyOf(surface), label: labelFor(surface) }))}
        active={launcher ? "" : activeKey}
        onPick={(k) => { pick(k); strip.current?.querySelector(`[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ inline: "nearest" }); }}
      />
      <TooltipButton
        className="workbench-files"
        data-action="workbench.files"
        aria-pressed={showFiles && !launcher}
        aria-label={t("common.files")}
        title={showFiles && !launcher ? t("workbench.hide_file_tree") : t("workbench.show_file_tree")}
        onClick={toggleExplorer}
      >
        <StudioIcon name="folder" />
        {changes.length > 0 && <small className="workbench-files-count">{changes.length}</small>}
      </TooltipButton>
        <div
          className="workbench-tablist"
          role="tablist"
          ref={strip}
          onWheel={(e) => {
            if (e.deltaY && strip.current) strip.current.scrollLeft += e.deltaY;
          }}
        >
        {surfaces.map((surface) => (
          <div
            className="workbench-tab"
            key={keyOf(surface)}
            role="tab"
            aria-selected={!launcher && surface === active}
            data-live={surface.kind === "browser" && surface.tab.active ? "" : undefined}
            data-dirty={surface.kind === "file" && unsaved.includes(surface.path) ? "" : undefined}
            data-key={keyOf(surface)} data-enter={entering.has(keyOf(surface)) ? "" : undefined}
            data-action-contextmenu="workbench.browser-menu" data-target={keyOf(surface)}
            onContextMenu={(e) => offerTabMenu(e, surface)}
          >
            {renaming === keyOf(surface) ? (
              <span className="workbench-tab-pick">
                <StudioIcon name="globe" />
                <input
                  className="workbench-tab-in"
                  aria-label={t("workbench.rename_tab")}
                  autoFocus
                  defaultValue={labelFor(surface)}
                  ref={(el) => el?.select()}
                  data-action-blur="workbench.rename-tab" data-action-keydown="workbench.rename-tab" data-target={keyOf(surface)}
                  onBlur={(e) => nameTab(surface, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.currentTarget.value = labelFor(surface); setRenaming(""); }
                  }}
                />
              </span>
            ) : (
            <button
              className="workbench-tab-pick"
              data-action-click="workbench.tab"
              data-action-keydown="workbench.browser-menu"
              data-target={keyOf(surface)}
              title={
                surface.kind === "browser"
                  ? `${surface.tab.active ? `${t("workbench.the_model_is_working_on")}
` : ""}${surface.tab.url}`
                  : labelFor(surface)
              }
              aria-haspopup="menu"
              aria-expanded={tabMenuKey === keyOf(surface)}
              onClick={() => pick(keyOf(surface))}
              onDoubleClick={surface.kind === "browser" ? () => setRenaming(keyOf(surface)) : undefined}
              data-action-dblclick="workbench.rename-tab"
              onKeyDown={(e) => {
                if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) offerTabMenu(e, surface);
                else if (e.key === "F2" && surface.kind === "browser") { e.preventDefault(); setRenaming(keyOf(surface)); }
              }}
            >
              <WorkbenchTabIcon surface={surface} />
              <span>{labelFor(surface)}</span>
              {surface.kind === "terminal" && surface.busy && <i className="workbench-tab-busy" aria-hidden />}
              {surface.kind === "changes" && changes.length > 0 && <small className="workbench-tab-count">{changes.length}</small>}
            </button>
            )}
            <button
              className="workbench-tab-close"
              data-action="workbench.close"
              data-target={keyOf(surface)}
              aria-label={t("common.disable_name", { name: labelFor(surface) })}
              title={t("common.close")}
              disabled={closing}
              onClick={(e) => {
                const tab = e.currentTarget.closest(".workbench-tab");
                if (surface.kind === "file" && unsaved.includes(surface.path)) setAsking({ path: surface.path, anchor: e.currentTarget });
                else leave(tab, () => void onClose([surface]));
              }}
            >
              <StudioIcon name="close" />
            </button>
          </div>
        ))}
        {launcher && (
          <div className="workbench-tab" role="tab" aria-selected="true" data-new="">
            <span className="workbench-tab-pick"><StudioIcon name="plus" /><span>{t("workbench.new_tab_label")}</span></span>
          </div>
        )}
        </div>
        <TooltipButton
          className="workbench-new"
          data-action="workbench.new"
          ref={newTab}
          aria-label={t("workbench.new_tab")}
          title={t("workbench.new_tab")}
          aria-expanded={launcher}
          onClick={toggleLauncher}
        >
          <StudioIcon name="plus" />
        </TooltipButton>
        {fullMode && <BrowserFullToggle {...fullMode} />}
      </header>
  );
}
