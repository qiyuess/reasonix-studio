import { t } from "../../i18n";
import { elapsed, stamp } from "../../i18n/format";
import { StudioIcon } from "../StudioIcon";

/** The turn's close: when it ran and how long it took, on one line under the
 *  reply. The range sits at the left edge and the duration at the right, so the
 *  two ends of the line answer different questions and neither hides the other.
 *  The range is stamped in full — date and seconds — because a turn read later
 *  has no "today" to be relative to. */
export function WorkedLine({ ms, startedAt }: { ms: number; startedAt?: number }) {
  return (
    <div className="rc" data-worked="">
      {startedAt !== undefined && (
        <span className="rc-span" dir="ltr">
          {stamp(startedAt)} ~ {stamp(startedAt + ms)}
        </span>
      )}
      <div className="rc-ok">
        <StudioIcon name="check" className="rc-tick" />
        <span className="rc-t">{t("chat.done_in_t", { t: elapsed(ms) })}</span>
      </div>
    </div>
  );
}
