import { useCallback } from "react";
import type { RuntimeView } from "../port/hub";

/** A new conversation belongs to no project: it opens in the app's own folder,
 *  and the pill on its composer is where a project is chosen. A pane on another
 *  machine keeps that machine's workspace — the far kernel has no such answer. */
export function useNewConversation(active: string, runtimes: RuntimeView[],
  open: (req: { root?: string; noProject?: boolean }) => Promise<void>,
  openRemote: (host: string, root?: string) => Promise<void>) {
  return useCallback(() => {
    const runtime = runtimes.find((rt) => rt.id === active);
    return runtime?.host ? openRemote(runtime.host, runtime.root) : open({ noProject: true });
  }, [active, runtimes, open, openRemote]);
}
