import { lazy } from "react";
import type { PaneReport } from "./Pane";

// Start fetching the settings chunk with the shell instead of waiting for the
// first click. It remains a separate chunk (and keeps its failure boundary),
// but opening settings no longer produces a veil while the module catches up.
const settingsModule = import("./Settings").then(
  (module) => ({ module, error: null as unknown }),
  (error: unknown) => ({ module: null, error }),
);
export const Settings = lazy(async () => {
  const loaded = await settingsModule;
  if (loaded.error) throw loaded.error;
  return { default: loaded.module!.Settings };
});

export const NO_REPORT: PaneReport = {
  status: null,
  workspace: null,
  title: "",
  steer: 0,
  run: "idle",
  live: false,
  cost: "",
  contextPercent: null,
  context: null,
  mcp: [],
  wallet: "",
  view: "flow",
  rows: 0,
};
