/**
 * The order the app tries remembered LAN addresses in.
 *
 * A computer can be behind two doors at once — its Wi-Fi address and a mesh
 * VPN one — and they are not equal: the direct door costs no tunnel. The
 * proxy orders them (it is the side that can see the interfaces); this checks
 * the app spends that order instead of inventing its own.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProxyConfig } from "../net/server";

const savedRows = vi.hoisted(() => ({
  current: [] as {
    kind: "lan";
    target: string;
    name: string;
    machine?: string;
    usedAt: number;
    order: number;
  }[],
}));

vi.mock("../net/savedConnections", () => ({
  loadConnections: () => savedRows.current,
  latestConnection: () => savedRows.current[0] ?? null,
  originName: (origin: string) => origin,
  normalizeTarget: (target: string) => target.trim().replace(/\/+$/, ""),
  rememberConnection: () => [],
  learnConnectionMachine: () => [],
  machineKey: (machine: string | undefined) => (machine ?? "").trim().toLowerCase(),
  originHost: (origin: string) => {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      return "";
    }
  },
  directDoorForMachine: () => null,
}));

const { lanDoorsOf, orderedDoors } = await import("./useLink");

function config(patch: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    origin: "",
    candidates: [],
    paired: true,
    ...patch,
  };
}

afterEach(() => {
  savedRows.current = [];
});

describe("lanDoorsOf", () => {
  it("follows the proxy's direct-first order", () => {
    // The tunnel address was paired later, so it heads `candidates`.
    const doors = lanDoorsOf(
      config({
        candidates: ["http://172.16.2.59:57074", "http://192.168.5.3:57074"],
        preferred: ["http://192.168.5.3:57074", "http://172.16.2.59:57074"],
      }),
    );

    expect(doors).toEqual(["http://192.168.5.3:57074", "http://172.16.2.59:57074"]);
  });

  it("still tries every door when the proxy named no order", () => {
    // A browser dev session, or a build older than `preferred`.
    const doors = lanDoorsOf(
      config({
        origin: "http://172.16.2.59:57074",
        candidates: ["http://172.16.2.59:57074", "http://192.168.5.3:57074"],
      }),
    );

    expect(doors).toEqual(["http://172.16.2.59:57074", "http://192.168.5.3:57074"]);
  });

  it("keeps a saved address the proxy never heard of", () => {
    savedRows.current = [
      { kind: "lan", target: "http://10.0.0.9:8791", name: "10.0.0.9", usedAt: 0, order: 0 },
    ];

    const doors = lanDoorsOf(
      config({ candidates: ["http://192.168.5.3:57074"], preferred: ["http://192.168.5.3:57074"] }),
    );

    // The proxy's order wins for what it knows; a row only the app remembers
    // is still a door, at the end.
    expect(doors).toEqual(["http://192.168.5.3:57074", "http://10.0.0.9:8791"]);
  });

  it("does not list the same address twice", () => {
    savedRows.current = [
      {
        kind: "lan",
        target: "http://192.168.5.3:57074",
        name: "192.168.5.3",
        usedAt: 0,
        order: 0,
      },
    ];

    const doors = lanDoorsOf(
      config({
        origin: "http://192.168.5.3:57074",
        candidates: ["http://192.168.5.3:57074"],
        preferred: ["http://192.168.5.3:57074"],
      }),
    );

    expect(doors).toEqual(["http://192.168.5.3:57074"]);
  });

  it("keeps one door per host when a restart left its old port behind", () => {
    // The proxy appends every origin it was ever told about, so a kernel that
    // restarted on a new port leaves both addresses in the list. Probing the
    // dead one costs a deadline and can never answer.
    const doors = lanDoorsOf(
      config({
        candidates: ["http://192.168.5.3:57074", "http://192.168.5.3:61234"],
        preferred: ["http://192.168.5.3:61234", "http://192.168.5.3:57074"],
      }),
    );

    expect(doors).toEqual(["http://192.168.5.3:61234"]);
  });

  it("keeps a second host for the same computer", () => {
    // A Wi-Fi address and a mesh-VPN address are two doors, not a restart.
    const doors = lanDoorsOf(
      config({
        candidates: ["http://192.168.5.3:57074", "http://172.16.2.59:57074"],
      }),
    );

    expect(doors).toEqual(["http://192.168.5.3:57074", "http://172.16.2.59:57074"]);
  });

  it("has nothing to try without a proxy or a saved row", () => {
    expect(lanDoorsOf(null)).toEqual([]);
    expect(lanDoorsOf(config())).toEqual([]);
  });
});

describe("orderedDoors", () => {
  function row(target: string, order: number) {
    return { kind: "lan" as const, target, name: target, usedAt: 0, order };
  }

  it("walks the saved list in the order the person arranged", () => {
    savedRows.current = [row("http://home:1", 0), row("http://office:2", 1)];

    expect(orderedDoors(config(), savedRows.current)).toEqual([
      { kind: "lan", target: "http://home:1", name: "http://home:1" },
      { kind: "lan", target: "http://office:2", name: "http://office:2" },
    ]);
  });

  it("puts a proxy address the app never recorded after the saved ones", () => {
    savedRows.current = [row("http://home:1", 0)];

    const doors = orderedDoors(
      config({
        origin: "http://proxy:9",
        candidates: ["http://proxy:9", "http://other:8"],
        preferred: ["http://other:8", "http://proxy:9"],
      }),
      savedRows.current,
    );

    // An address somebody ranked must not be overtaken by one only the proxy
    // remembers; among those, the proxy's own order still decides.
    expect(doors.map((door) => door.target)).toEqual([
      "http://home:1",
      "http://proxy:9",
      "http://other:8",
    ]);
  });

  it("does not repeat a target the proxy and the saved list share", () => {
    savedRows.current = [row("http://home:1", 0)];

    const doors = orderedDoors(
      config({ origin: "http://home:1", candidates: ["http://home:1"] }),
      savedRows.current,
    );

    expect(doors).toEqual([{ kind: "lan", target: "http://home:1", name: "http://home:1" }]);
  });

  it("leaves out what this attempt already tried", () => {
    savedRows.current = [row("http://home:1", 0), row("http://office:2", 1)];

    const doors = orderedDoors(config(), savedRows.current, ["http://home:1"]);

    expect(doors.map((door) => door.target)).toEqual(["http://office:2"]);
  });

  it("has nothing to walk when neither the app nor the proxy knows a door", () => {
    expect(orderedDoors(config(), [])).toEqual([]);
    expect(orderedDoors(null, [])).toEqual([]);
  });

  it("an ephemeral kernel ignores doors saved by another session", () => {
    savedRows.current = [row("http://real:55716", 0)];
    const ephemeral = config({
      origin: "http://mock.local",
      candidates: ["http://mock.local"],
      ephemeral: true,
    });

    expect(lanDoorsOf(ephemeral)).toEqual(["http://mock.local"]);
    expect(orderedDoors(ephemeral, savedRows.current)).toEqual([
      { kind: "lan", target: "http://mock.local", name: "http://mock.local" },
    ]);
  });
});
