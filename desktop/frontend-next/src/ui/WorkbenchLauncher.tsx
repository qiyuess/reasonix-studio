import { t } from "../i18n";
import { StudioIcon } from "./StudioIcon";

export function WorkbenchLauncher({ changes, focus = false, onFiles, onBrowser, onTerminal }: { changes: number; focus?: boolean; onFiles: () => void; onBrowser: () => void; onTerminal?: () => void }) {
  return (
    <div className="workbench-launcher" role="group" aria-label={t("common.start")}>
      <button autoFocus={focus} aria-label={t("workbench.explorer")} data-action="workbench.launch-files" onClick={onFiles}>
        <StudioIcon name="folder" />
        <span><b>{t("workbench.explorer")}{changes > 0 && <small>{changes}</small>}</b><i>{t("workbench.changes_history_and_files")}</i></span>
      </button>
      <button aria-label={t("workbench.browser")} data-action="workbench.launch-browser" onClick={onBrowser}>
        <StudioIcon name="globe" />
        <span><b>{t("workbench.browser")}</b><i>{t("workbench.view_web_pages_beside_the")}</i></span>
      </button>
      {onTerminal && (
        <button aria-label={t("terminal.name")} data-action="workbench.launch-terminal" onClick={onTerminal}>
          <StudioIcon name="terminal" />
          <span><b>{t("terminal.name")}</b><i>{t("terminal.launch_hint")}</i></span>
        </button>
      )}
    </div>
  );
}
