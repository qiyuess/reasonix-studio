import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { t } from "../i18n";
import { Picker, type MenuItem } from "./Menu";
import { StudioIcon } from "./StudioIcon";
import { PRESETS, SCALES, clampSide, deviceOf, presetOf, PANEL, type Chosen } from "./browserSize";

/** What a size's row calls itself: a preset's own name, the panel's when the
 *  page is laid out in the room itself, and "Custom" for a size somebody typed. */
const labelOf = (preset: string): string => {
  const chosen = PRESETS.find((one) => one.id === preset);
  if (chosen) return t(chosen.key);
  return t(preset === PANEL ? "workbench.size_panel" : "workbench.size_custom");
};

/** BrowserSizeBar is the row above a framed page: which size it is laid out in,
 *  and how much of the panel it takes. The numbers are the page's own CSS
 *  pixels, so a width of 393 answers a phone's media queries; the mode only
 *  decides how that frame is drawn into the room around it.
 *
 *  `panel` is on for a page the shell draws itself: that page can also be left
 *  alone — laid out in the rectangle the panel gave it, as wide as the room —
 *  which is a row of its own there. */
export function BrowserSizeBar({ size, onChange, panel = false }: { size: Chosen; onChange: (next: Chosen) => void; panel?: boolean }) {
  const preset = presetOf(size);
  // What is in the two fields right now. A field being typed into is not a size
  // yet — "39" on the way to "393" would otherwise be clamped to the floor.
  const [draft, setDraft] = useState({ width: String(size.width), height: String(size.height) });
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setDraft({ width: String(size.width), height: String(size.height) });
  }, [size.width, size.height]);

  // A page the shell draws itself can also be left alone: laid out in the
  // rectangle the panel gave it, as wide as the room. That row is only offered
  // where it means something, which is where the page is not one this panel
  // frames itself.
  const presetItems: MenuItem[] = [
    ...(panel ? [{ value: PANEL, label: t("workbench.size_panel") }] : []),
    ...PRESETS.map((one) => ({ value: one.id, label: t(one.key), meta: `${one.width} × ${one.height}` })),
  ];
  const modeItems: MenuItem[] = SCALES.map((one) => ({ value: one.id, label: t(one.key) }));

  const take = (value: string) => {
    if (value === PANEL) {
      // The panel's own size is the page as the room drew it: a desktop
      // answering on its own, so the device the last preset stood for is
      // taken away with it.
      onChange({ ...size, framed: false, device: null });
      return;
    }
    const one = PRESETS.find((preset) => preset.id === value);
    // A preset is a device, not only a size: the page it frames answers as a
    // phone or a tablet — its UA and its mobile layout — from the moment it
    // is chosen, the way the toolbar's own device answer does. Numbers typed
    // after keep the device, so changing how much of it shows is not asking
    // the page to be a desktop again.
    if (one) onChange({ width: one.width, height: one.height, mode: size.mode, framed: true, device: deviceOf(one) });
  };

  // Losing focus or pressing Enter settles a side. Anything that is not a
  // positive number puts back what the page is actually at, so the field never
  // reads a size the frame does not have.
  const settle = (side: keyof typeof draft, raw: string) => {
    const typed = Number(raw);
    if (!Number.isFinite(typed) || typed <= 0) {
      setDraft({ width: String(size.width), height: String(size.height) });
      return;
    }
    const value = clampSide(typed);
    // Typing a number is asking for a frame of that size — the row is open
    // because a size is wanted, so the numbers settle it rather than reading
    // back into a page still laid out as the room. The device is kept: a
    // frame someone resized is still standing on the same device, and the
    // page keeps answering as it did — only the toolbar's device menu takes
    // that identity away again.
    if (side === "height") {
      const width = locked && size.height > 0 ? clampSide(Math.round((value * size.width) / size.height)) : size.width;
      onChange({ ...size, width, height: value, framed: true });
      return;
    }
    const height = locked && size.width > 0 ? clampSide(Math.round((value * size.height) / size.width)) : size.height;
    onChange({ ...size, width: value, height, framed: true });
  };

  const field = (side: keyof typeof draft) => (
    <input
      className="size-side"
      data-action-change={`browser.size.${side}`}
      inputMode="numeric"
      value={draft[side]}
      aria-label={t(side === "width" ? "workbench.size_width" : "workbench.size_height")}
      spellCheck={false}
      onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft((now) => ({ ...now, [side]: event.target.value }))}
      onBlur={(event) => settle(side, event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        settle(side, event.currentTarget.value);
      }}
    />
  );

  return (
    <div className="studio-browser-size" role="group" aria-label={t("workbench.size_viewport")}>
      <Picker
        className="size-picker"
        data-action="browser.size.preset"
        place="bottom"
        current={preset}
        items={presetItems}
        onPick={take}
        label={<>
          <span className="lb">{labelOf(preset)}</span>
          <StudioIcon name="down" />
        </>}
      />
      <div className="size-sides">
        {field("width")}
        <button
          type="button"
          className="size-lock"
          data-action="browser.size.lock"
          aria-pressed={locked}
          aria-label={t("workbench.size_lock_ratio")}
          title={t("workbench.size_lock_ratio")}
          onClick={() => setLocked((was) => !was)}
        >×</button>
        {field("height")}
      </div>
      <Picker
        className="size-picker"
        data-action="browser.size.fit"
        place="bottom"
        align="end"
        current={size.mode}
        items={modeItems}
        onPick={(value) => onChange({ ...size, mode: SCALES.find((one) => one.id === value)?.id ?? "fit" })}
        label={<>
          <span className="lb">{t(SCALES.find((one) => one.id === size.mode)?.key ?? "workbench.size_fit")}</span>
          <StudioIcon name="down" />
        </>}
      />
    </div>
  );
}
