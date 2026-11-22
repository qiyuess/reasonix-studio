/** One open pane, as the hub reports it on `GET /runtimes`. */
export interface RuntimeView {
  id: string;
  /** Request prefix every call for this pane carries, e.g. `/rt/ab12`. */
  base: string;
  /** Workspace root the pane has open. */
  root: string;
  name: string;
  /** The name the person gave this project on the computer (the sidebar
   *  rename). Absent when the folder was never renamed; rows fall back to
   *  `name`, which stays the folder's own. */
  displayName?: string;
  sessionPath?: string;
  host?: string;
  /** Another process holds the write lease: readable, not writable. */
  readOnly?: boolean;
  /** The pane belongs to no project: the computer's own folder, not
   *  someone's — a folder name there is noise. */
  noProject?: boolean;
}
