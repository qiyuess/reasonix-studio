/**
 * Opening one remembered door.
 *
 * A door is not open when the proxy has been told where to send requests. It
 * is open when the kernel on the other side answers for itself, so every path
 * here ends with `probeUpstream` — the difference between saving an address
 * and connecting to a computer. The steps are reported as they happen so the
 * Home chip and the settings screen can say which one is running.
 */

import { linkFailure } from "./link";
import type { LinkError, LinkStep } from "./link";
import { syncFleetPeer } from "./fleet";
import { learnConnectionMachine, rememberConnection } from "./savedConnections";
import {
  configureProxy,
  probeDoor,
  probeUpstream,
  readMachineIdentity,
  readProxyConfig,
  ProxyError,
} from "./server";
import type { ProxyConfig } from "./server";

export interface Door {
  kind: "lan";
  /** A LAN or reverse-proxy origin. */
  target: string;
  /**
   * The launch token this origin asks for, when the kernel was paired with one.
   * A neighbour on the same Wi-Fi pairs with a cookie instead and has none.
   */
  token?: string;
  /** What to call it in the UI. */
  name?: string;
  /** The computer's own name, when a saved row already knew it. */
  machine?: string;
}

/**
 * What opening a door answered. A success carries the machine name the far side
 * gave when it named itself: `openDoor` already holds it from its own probe, and
 * a caller moving a live conversation needs it to prove the new door reaches the
 * same computer rather than another one wearing the same host name.
 */
export type DoorResult =
  | { ok: true; machine: string }
  | { ok: false; error: LinkError };

/**
 * Put the route back the way it was before a switch.
 *
 * A door cannot be verified until the proxy has been pointed at it: the switch
 * has to name the candidate upstream before `/runtimes` can be read through it.
 * When that verification fails the old route is already gone, and a person who
 * asked for a switch would be left on a dead address with nothing answering —
 * the app would look connected to nothing until the next walk.
 *
 * Restoring is best-effort and never replaces the caller's error: the switch
 * failed, and saying so is the honest answer.
 */
async function restoreRoute(previous: ProxyConfig | null): Promise<void> {
  if (previous === null || !previous.origin) return;
  try {
    await configureProxy(previous.origin);
  } catch {
    // Nothing left to restore to. The original failure is still reported.
  }
}

export async function openDoor(
  door: Door,
  onStep: (step: LinkStep) => void,
): Promise<DoorResult> {
  try {
    onStep("switch");
    // Verify before tearing anything down. The switch itself is a local
    // write, so a door that cannot answer leaves the current route intact —
    // that is the difference between a handover and an outage.
    // A door paired with a launch token carries it; a neighbour pairs instead
    // and must not be sent one. Passing it only when it exists keeps the two
    // shapes distinguishable to callers that assert on them.
    const pre = door.token
      ? await probeDoor(door.target, door.token)
      : await probeDoor(door.target);
    if (!pre.ok) {
      return { ok: false, error: linkFailure(pre.code, `origin ${door.target}`) };
    }
    // What the proxy pointed at before this switch, so a door that answers its
    // probe but not `/runtimes` can put it back.
    const before = await readProxyConfig();
    // Omitting the token keeps whatever this origin already had; a door that
    // carries one replaces it, and that is what makes a token-paired kernel
    // usable after the first connect.
    await (door.token
      ? configureProxy(door.target, undefined, door.token)
      : configureProxy(door.target));
    onStep("verify");
    const reach = await probeUpstream();
    if (!reach.ok) {
      await restoreRoute(before);
      return { ok: false, error: linkFailure(reach.code, `origin ${door.target}`) };
    }
    rememberConnection(door.target, door.name, door.machine);
    // The probe already named the computer; only a build that could not answer
    // it needs the late read.
    if (pre.machine) learnConnectionMachine(door.target, pre.machine);
    else {
      void readMachineIdentity(door.target).then((identity) => {
        if (identity) learnConnectionMachine(door.target, identity.machine);
      });
    }
    void syncFleetPeer(door.target, door.name ?? door.target).catch(() => {});
    return { ok: true, machine: pre.machine };
  } catch (error) {
    return { ok: false, error: failureFromError(error) };
  }
}

export function failureFromError(error: unknown): LinkError {
  if (error instanceof ProxyError) return linkFailure(error.code, error.message);
  return linkFailure("client.offline", error instanceof Error ? error.message : String(error));
}
