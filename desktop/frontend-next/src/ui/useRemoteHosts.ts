import { useCallback, useEffect, useState } from "react";
import type { HubPort } from "../port/hub";
import type { RemoteAsk, RemoteHost } from "../port/remote";

// The window's view of the other machines: the hosts it knows, the dials in
// flight, and a connect stopped for a question. One hook so the poll, the
// answer and the ask all live on the same state.
export function useRemoteHosts(hub: HubPort) {
  const [remotes, setRemotes] = useState<RemoteHost[] | null>(null);
  // Connects in flight. A link reports "connecting" only once the dial starts,
  // so without this the poll would look at an idle list and stand down exactly
  // when the step list is what the user is waiting on.
  const [opening, setOpening] = useState(0);
  // A connect stopped for a question. One at a time by construction: the link
  // that asked is blocked until it is answered.
  const [ask, setAsk] = useState<RemoteAsk | null>(null);

  const reloadRemotes = useCallback(
    () =>
      hub
        .remoteHosts()
        .then(setRemotes)
        .catch(() => setRemotes(null)),
    [hub],
  );

  useEffect(() => {
    void reloadRemotes();
  }, [reloadRemotes]);

  // One timer per answer, not one that runs regardless: a link mid-connect
  // changes by the second, a settled one only when something breaks, and three
  // idle hosts should cost nothing at all.
  useEffect(() => {
    if (!remotes?.length) return;
    const working = opening > 0 || remotes.some((h) => h.status === "connecting" || h.status === "reconnecting");
    if (!working && remotes.every((h) => h.status === "idle")) return;
    const timer = setTimeout(() => void reloadRemotes(), working ? 400 : 5000);
    return () => clearTimeout(timer);
  }, [remotes, opening, reloadRemotes]);

  useEffect(() => hub.onRemoteAsk(setAsk), [hub]);

  const answerRemote = useCallback(
    (id: string, ok: boolean, text: string) => {
      setAsk(null);
      hub.answerRemote(id, ok, text);
    },
    [hub],
  );

  return { remotes, opening, setOpening, ask, reloadRemotes, answerRemote };
}
