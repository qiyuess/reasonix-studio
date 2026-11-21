import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import type { TreeWorkspace } from "../port/hub";
import { StudioIcon } from "./StudioIcon";
import { listenAction } from "./listen";
import { pinToViewport } from "./place";

export interface BlankAdder {
  pickFolder: (preferred?: string) => Promise<string | null>;
  addFolder: (path: string, displayName?: string) => Promise<TreeWorkspace>;
}

/** The folder the picker returned *is* the project. A name typed in the first
 *  field renames it in the sidebar only — the folder keeps the name it has on
 *  disk, so one called shop-web can read as a completely different label.
 *
 *  The dialog is shared — the composer's pill and the sidebar's plus both land a
 *  new project with it — and `onDone` carries the workspace that was made. */
export function BlankProjectDialog({ adder, onDone, onClose, onError }: {
  adder: BlankAdder;
  onDone: (workspace: TreeWorkspace) => void | Promise<void>;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  // Starts empty: a name identical to the folder's changes nothing, so the
  // field stays out of the way until someone wants a different label.
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [noPicker, setNoPicker] = useState(false);
  const [working, setWorking] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  // The card centres itself: the pill used to pin it from outside, and the
  // sidebar's plus has no such hand to lend.
  useEffect(() => {
    const put = () => {
      const el = card.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      pinToViewport(el, (innerWidth - box.width) / 2, (innerHeight - box.height) / 2, 12);
    };
    put();
    const observer = new ResizeObserver(put);
    if (card.current) observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  // The card is its own door: its field starts selected, Escape and an
  // outside click dismiss it, and its buttons are the only way through.
  useEffect(() => {
    card.current?.querySelector<HTMLInputElement>("input")?.select();
    const outside = (event: MouseEvent) => {
      if (!card.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    };
    const stopOutside = listenAction(window, "mousedown", { action: "workspace.create", listener: outside as EventListener });
    const stopKey = listenAction(window, "keydown", { action: "workspace.create", listener: key as EventListener }, true);
    return () => { stopOutside(); stopKey(); };
  }, [onClose]);
  const pickParent = () => {
    // A picker without a desktop host to answer it — null, or an error — falls
    // back to typing the folder: the path field replaces the picker row. The
    // start folder is the platform's own: a fresh conversation works inside the
    // app's own area, and a new project is nobody's subfolder of it.
    void adder.pickFolder("").then((dir) => {
      if (dir) setParent(dir);
      else setNoPicker(true);
    }).catch(() => setNoPicker(true));
  };
  const createBlank = () => {
    const named = name.trim();
    const at = noPicker ? parent.trim() : parent;
    if (!at || working) return;
    setWorking(true);
    void adder.addFolder(at, named)
      .then(async (workspace) => {
        await onDone(workspace);
        onClose();
      })
      .catch(onError)
      .finally(() => setWorking(false));
  };
  return createPortal(<div ref={card} className="workspace-blank" role="dialog" aria-label={t("session.new_blank_project")}>
    <div className="workspace-blank-head">
      <span className="workspace-blank-mark"><StudioIcon name="folder" /></span>
      <button data-action="layer.dismiss" className="workspace-palette-close" aria-label={t("common.close")} onClick={onClose}><StudioIcon name="close" /></button>
    </div>
    <h2>{t("session.new_blank_project")}</h2>
    <label className="workspace-blank-field">
      <span>{t("session.project_name")}</span>
      <input value={name} placeholder={t("session.defaults_to_folder_name")}
        onChange={(ev) => setName(ev.currentTarget.value)}
        onKeyDown={(ev) => { if (ev.key === "Enter") createBlank(); }} />
    </label>
    <div className="workspace-blank-field">
      <span>{t("session.source_folder")}</span>
      <div className="workspace-blank-pick" data-empty={parent || !noPicker ? undefined : ""}>
        {parent ? (
          <button type="button" data-action="workspace.add-existing" title={parent} onClick={pickParent}>
            <StudioIcon name="folder" /><span>{parent}</span>
          </button>
        ) : noPicker ? (
          <input type="text" placeholder={t("session.the_folder_picker_cannot_open")}
            value={parent} onChange={(ev) => setParent(ev.currentTarget.value)} />
        ) : (
          <button type="button" data-action="workspace.add-existing" onClick={pickParent}>
            <StudioIcon name="folder" /><span>{t("session.choose_folder")}</span>
          </button>
        )}
        <small>{t("session.blank_project_lands_here")}</small>
      </div>
    </div>
    <p className="workspace-blank-hint">{t("session.name_a_folder_first")}</p>
    <div className="workspace-blank-go">
      <button type="button" data-action="layer.dismiss" disabled={working} onClick={onClose}>{t("common.cancel")}</button>
      <button type="button" className="pick" data-action="workspace.create" disabled={working || !parent.trim()}
        onClick={createBlank}>{t("session.create_the_project")}</button>
    </div>
  </div>, document.body);
}
