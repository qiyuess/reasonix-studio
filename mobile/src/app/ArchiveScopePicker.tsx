/**
 * The 全部 / 已归档 picker for the home section heads.
 *
 * The desktop draws this as a small dropdown; on the phone it is the same
 * sheet pattern as every other chooser here: a compact trigger that shows the
 * current share, opening the chooser sheet where one tap switches and closes.
 * One component for both heads (最近 and 项目), so the two rows agree.
 */

import { useState } from "react";
import { useBackCloser } from "./backStack";
import { StudioIcon } from "./StudioIcon";

export type ArchiveScope = "active" | "archived";

const SCOPES: { value: ArchiveScope; label: string }[] = [
  { value: "active", label: "全部" },
  { value: "archived", label: "已归档" },
];

export function ArchiveScopePicker({
  scope,
  onChange,
  label,
}: {
  scope: ArchiveScope;
  onChange: (scope: ArchiveScope) => void;
  /** Which list the sheet is choosing for, in the sheet's own heading. */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const current = SCOPES.find((entry) => entry.value === scope) ?? SCOPES[0];
  const currentLabel = current?.label ?? "全部";
  useBackCloser(open, () => setOpen(false));

  return (
    <>
      <button
        type="button"
        className="scope-picker"
        data-action="home.scope"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}：${currentLabel}`}
        onClick={() => setOpen(true)}
      >
        <span className="scope-picker-value">{currentLabel}</span>
        <StudioIcon name="down" className="scope-picker-chev" />
      </button>
      {open ? (
        <div className="sheet-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${label}筛选`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-head">
              <h2>{label}筛选</h2>
              <button type="button" className="iconbtn" onClick={() => setOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <ul className="sheet-actions" role="listbox" aria-label={`${label}筛选`}>
              {SCOPES.map((entry) => (
                <li key={entry.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={entry.value === scope}
                    className={entry.value === scope ? "on" : ""}
                    onClick={() => {
                      setOpen(false);
                      if (entry.value !== scope) onChange(entry.value);
                    }}
                  >
                    {entry.label}
                    {entry.value === scope ? <StudioIcon name="check" className="scope-check" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </>
  );
}
