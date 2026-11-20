import { StudioIcon } from "./StudioIcon";

/**
 * The fold arrow a run's label carries, and nothing else.
 *
 * A folder mark used to ride beside it. The label already names what the run
 * holds — 项目 for folders the person chose, 任务 for the window's own — so the
 * second icon repeated the words next to it, and every label in the rail grew
 * one. The arrow is the only mark the label needs: folded it points ahead, open
 * it points down, and a run with nothing to fold hides it.
 */
export function WsMark({ open }: { open: boolean | undefined }) {
  return (
    <StudioIcon name="down" className="wschev ds-chev" data-open={open ? "" : undefined} data-leaf={open === undefined ? "" : undefined} />
  );
}
