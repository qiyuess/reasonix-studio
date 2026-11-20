import type { ReactNode } from "react";
import { t } from "../i18n";
import { RMark } from "./RMark";
import { RunClock } from "./RunClock";
import { RunTokens } from "./RunTokens";
import { useShowsCompositionPicker } from "../state/compositionPicker";

export function RunLine({
  label,
  running,
  blocked,
  since,
  sent,
  received,
  estimated,
  aside,
  children,
}: {
  label: string;
  running: boolean;
  blocked: boolean;
  since?: number;
  sent: number;
  received: number;
  estimated: boolean;
  /** Shown beside the status whatever the agent picker's switch says: the
   *  project's name is its own answer, not part of that setting. */
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const showsPicker = useShowsCompositionPicker();
  const picker = showsPicker ? children : null;
  const status = (
    <div
      className="studio-runstate"
      role="status"
      aria-live="polite"
      data-running={running && !blocked ? "" : undefined}
      data-waiting={blocked ? "" : undefined}
      data-idle={running || blocked ? undefined : ""}
    >
      <span className="studio-runlabel">
        <RMark />
        <span className="sr-only">{t(label)}</span>
        {running && since !== undefined && <RunClock since={since} />}
      </span>
      <RunTokens sent={sent} received={received} estimated={estimated} />
    </div>
  );
  // One row above the input box holds both answers — what it runs as, and where
  // it lives — and the status keeps the right edge. The row is drawn whenever
  // any of the three has something to say, so the project's name survives the
  // agent picker being switched off.
  return picker || aside ? (
    <div className="compose-context">
      {picker}
      {aside}
      {status}
    </div>
  ) : (
    status
  );
}
