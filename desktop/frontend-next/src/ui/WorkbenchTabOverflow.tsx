import { t } from "../i18n";

/** "+n" at the end of a strip too narrow for its tabs: how many are not on
 *  screen. Shown, not pressed — the picker at the front of the strip is already
 *  the way to reach one of them, and a second control doing the same thing
 *  beside the tabs only made the strip look like it had two of everything. */
export function WorkbenchTabOverflow({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="workbench-overflow" title={t("workbench.n_more_not_shown", { n: count })}>
      +{count}
    </span>
  );
}
