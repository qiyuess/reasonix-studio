/**
 * Whether two doors lead to the same computer.
 *
 * A handover swaps the transport under a conversation, and a runtime id only
 * means something on the kernel that minted it. Moving to another computer
 * would silently replace the project, the panes and the transcript, so an
 * automatic switch is allowed only when both doors carry the same machine
 * identity.
 *
 * Identity comes from the saved list, which is the one place both doors meet:
 * a door learns the computer's own name (`readMachineIdentity`) and keeps it on
 * its row. A row written before the identity field existed has no name to offer,
 * so it falls back to the row's own label — which is what a recovery from an
 * older build has to compare.
 *
 * Absence is a refusal, never a guess: "unknown" and "different" call for
 * different answers, because only one of them says another computer answers
 * there. Two machines can share a host name, and a wrong switch costs more
 * than a link that stays down.
 */

import { normalizeTarget, originName } from "./savedConnections";
import type { SavedConnection, SavedConnectionKind } from "./savedConnections";

export interface DoorRef {
  kind: SavedConnectionKind;
  target: string;
}

/** What the saved list can say about two doors, never more. */
export type MachineRelation = "same" | "different" | "unknown";

/**
 * The identity a saved row carries, or "" when the row has not learned one.
 *
 * A row is named by the computer itself once a probe answered; a row that has
 * not answered yet has only the label the person's list gave it.
 */
function identityOf(rows: SavedConnection[], door: DoorRef): string {
  const target = normalizeTarget(door.target);
  const row = rows.find(
    (candidate) =>
      candidate.kind === door.kind &&
      normalizeTarget(candidate.target) === target,
  );
  if (!row) return "";
  const learned = (row.machine ?? "").trim();
  if (learned) return learned;
  // A row that has not been named by its computer carries the label the list
  // gave it — and that label is usually the address itself, which says nothing
  // about which computer answers there. Reading it as an identity would call
  // one machine two, so an address-shaped label answers "" instead.
  const named = (row.name ?? "").trim();
  if (!named) return "";
  return named === target || named === originName(target) ? "" : named;
}

/** One spelling per machine, matching `machineKey`'s own normalisation. */
function fold(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Whether two doors are proven to reach the same computer, another one, or
 * cannot be told apart from what the saved list knows.
 */
export function machineRelation(
  rows: SavedConnection[],
  a: DoorRef,
  b: DoorRef,
): MachineRelation {
  const left = identityOf(rows, a);
  const right = identityOf(rows, b);
  if (!left || !right) return "unknown";
  return fold(left) === fold(right) ? "same" : "different";
}
