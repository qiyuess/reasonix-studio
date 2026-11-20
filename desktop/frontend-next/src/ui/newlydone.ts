// Which runs reached "done" since `before` last recorded them. A state is not
// an event: `done` persists, so only a change no first sighting can produce —
// both sides known and different — is the completion this window watched.
export function newlyDone(
  before: Record<string, string>,
  runs: Record<string, { run: string; live: boolean }>,
): string[] {
  const fresh: string[] = [];
  for (const [id, st] of Object.entries(runs)) {
    if (st.run === "done" && before[id] !== undefined && before[id] !== "done") fresh.push(id);
    before[id] = st.run;
  }
  return fresh;
}
