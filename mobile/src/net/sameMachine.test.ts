/**
 * What the saved list can say about two doors.
 *
 * Three answers, because two of them lead to different fixes: a proven other
 * computer is never opened automatically, while an unnamed one is only kept
 * out of a swap. These cases pin both, plus the fallbacks that must not invent
 * an identity.
 *
 * Two doors are two addresses that may or may not reach one computer: the
 * neighbour on Wi-Fi and the reverse proxy the person configured are the usual
 * pair, and telling them apart is what stops a swap from silently replacing
 * the project and the transcript.
 */

import { describe, expect, it } from "vitest";
import { machineRelation } from "./sameMachine";
import type { SavedConnection } from "./savedConnections";

function row(
  patch: Partial<SavedConnection> & Pick<SavedConnection, "kind" | "target">,
): SavedConnection {
  return { name: patch.target, usedAt: 0, order: 0, ...patch };
}

const LAN = "http://192.168.5.3:57074";
const PROXY = "https://agent.example.com";

describe("machineRelation", () => {
  it("recognises one computer behind two addresses", () => {
    const rows = [
      row({ kind: "lan", target: LAN, machine: "MacBook-Pro" }),
      row({ kind: "lan", target: PROXY, machine: "MacBook-Pro" }),
    ];

    expect(
      machineRelation(rows, { kind: "lan", target: LAN }, { kind: "lan", target: PROXY }),
    ).toBe("same");
  });

  it("ignores case and repeated spaces in the machine name", () => {
    const rows = [
      row({ kind: "lan", target: LAN, machine: "  MacBook   Pro " }),
      row({ kind: "lan", target: PROXY, machine: "macbook pro" }),
    ];

    expect(
      machineRelation(rows, { kind: "lan", target: LAN }, { kind: "lan", target: PROXY }),
    ).toBe("same");
  });

  it("proves another computer even when their labels look alike", () => {
    const rows = [
      row({ kind: "lan", target: LAN, name: "MacBook-Pro", machine: "MacBook-Pro" }),
      row({ kind: "lan", target: PROXY, name: "MacBook-Pro", machine: "MacBook-Pro-2" }),
    ];

    expect(
      machineRelation(rows, { kind: "lan", target: LAN }, { kind: "lan", target: PROXY }),
    ).toBe("different");
  });

  it("treats a row's own label as its identity when no probe has named it", () => {
    // A row seen once, before the far side answered with its name, is labelled
    // by whatever the person's list called it. That label is the only identity
    // the list has, and refusing to read it would make every older row unknown.
    const rows = [
      row({ kind: "lan", target: LAN, machine: "MacBook-Pro" }),
      row({ kind: "lan", target: PROXY, name: "MacBook-Pro" }),
    ];

    expect(
      machineRelation(rows, { kind: "lan", target: LAN }, { kind: "lan", target: PROXY }),
    ).toBe("same");
  });

  it("is unknown when the saved list has never seen a door", () => {
    const rows = [row({ kind: "lan", target: PROXY, machine: "MacBook-Pro" })];

    expect(
      machineRelation(rows, { kind: "lan", target: LAN }, { kind: "lan", target: PROXY }),
    ).toBe("unknown");
  });

  it("does not read a row's address as a machine name", () => {
    // A row is named by its host:port when nothing else named it, which says
    // nothing about which computer answers there. Calling that "different"
    // would refuse a door that may well be the same machine.
    const rows = [
      row({ kind: "lan", target: LAN, name: "192.168.5.3:57074" }),
      row({ kind: "lan", target: PROXY, name: "MacBook-Pro", machine: "MacBook-Pro" }),
    ];

    expect(
      machineRelation(rows, { kind: "lan", target: LAN }, { kind: "lan", target: PROXY }),
    ).toBe("unknown");
  });

  it("matches a target spelled with a trailing slash", () => {
    const rows = [
      row({ kind: "lan", target: LAN, machine: "MacBook-Pro" }),
      row({ kind: "lan", target: PROXY, machine: "MacBook-Pro" }),
    ];

    expect(
      machineRelation(
        rows,
        { kind: "lan", target: `${LAN}/` },
        { kind: "lan", target: PROXY },
      ),
    ).toBe("same");
  });
});
