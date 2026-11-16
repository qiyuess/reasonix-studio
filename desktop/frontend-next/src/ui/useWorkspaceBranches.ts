import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentPort, WorkspaceBranch, WorkspaceGit } from "../port/port";

export function useWorkspaceBranches(port: AgentPort, onChanged: () => void, onSwitched: ((git: WorkspaceGit) => void) | undefined, onError: (error: unknown) => void, root = "", repo = "") {
  const [locals, setLocals] = useState<WorkspaceBranch[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const [reading, setReading] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const generation = useRef(0);
  const asked = useRef(false);
  const load = useRef<() => void>(() => {});
  useEffect(() => { generation.current++; setLocals([]); setMoving(null); setReading("idle"); if (asked.current) load.current(); return () => { generation.current++; }; }, [port, root, repo]);
  const loadBranches = useCallback(() => {
    const current = generation.current;
    asked.current = true;
    setReading("loading");
    // A workspace that is its own repository names no folder, and the call it
    // makes stays the one argument it always was: an extra `undefined` reads as
    // a different call to anything counting them.
    const reading = repo ? port.branches(repo) : port.branches();
    void reading.then((result) => { if (current === generation.current) { asked.current = false; setLocals(result.branches); setReading("ready"); } }).catch((error) => { if (current === generation.current) { asked.current = false; setReading("failed"); onError(error); } });
  }, [port, onError, root, repo]);
  load.current = loadBranches;
  const switchTo = (name: string) => {
    if (moving !== null) return;
    const current = generation.current;
    setMoving(name);
    const answered = repo ? port.switchBranch(name, repo) : port.switchBranch(name);
    void answered.then((git) => {
      if (current !== generation.current) return;
      onChanged(); onSwitched?.(git);
    }).catch((error) => { if (current === generation.current) onError(error); })
      .finally(() => { if (current === generation.current) setMoving(null); });
  };
  return { locals, moving, reading, loadBranches, switchTo };
}
