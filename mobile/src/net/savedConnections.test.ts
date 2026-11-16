import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionKey,
  directDoorForMachine,
  forgetConnection,
  forgetConnectionGroup,
  groupConnections,
  isRemoteOrigin,
  latestConnection,
  learnConnectionMachine,
  loadConnections,
  machineKey,
  moveConnection,
  moveConnectionGroup,
  normalizeTarget,
  originName,
  rememberConnection,
} from "./savedConnections";

beforeEach(() => localStorage.clear());

describe("normalizeTarget", () => {
  it("drops the slash a person may have typed after a LAN origin", () => {
    expect(normalizeTarget(" http://192.168.5.2:56789/ ")).toBe("http://192.168.5.2:56789");
  });

  it("refuses an origin that is not http(s)", () => {
    expect(normalizeTarget("ftp://192.168.5.2")).toBe("");
    expect(normalizeTarget("192.168.5.2:56789")).toBe("");
  });

  it("keeps a reverse proxy's https origin, which is a door like any other", () => {
    expect(normalizeTarget(" https://agent.example.com/ ")).toBe("https://agent.example.com");
    expect(normalizeTarget("   ")).toBe("");
  });
});

describe("originName", () => {
  it("names a corner of the LAN by host and port", () => {
    expect(originName("http://192.168.5.2:56789")).toBe("192.168.5.2:56789");
  });

  it("falls back to the raw value when it is not a URL", () => {
    expect(originName("not a url")).toBe("not a url");
  });
});

describe("rememberConnection", () => {
  it("records a LAN computer under its host", () => {
    const rows = rememberConnection("http://192.168.5.2:56789/");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "lan",
      target: "http://192.168.5.2:56789",
      name: "192.168.5.2:56789",
    });
    expect(loadConnections()).toEqual(rows);
  });

  it("keeps a repeat where it sits instead of moving it", () => {
    rememberConnection("http://a:1");
    rememberConnection("https://proxy.example.com");
    rememberConnection("http://b:2");
    // The person arranged this list; reconnecting to the first computer must
    // not quietly reorder it.
    const rows = rememberConnection("http://a:1/");
    expect(rows.map((row) => row.target)).toEqual(["http://a:1", "https://proxy.example.com", "http://b:2"]);
  });

  it("lets a later computer name replace an id", () => {
    rememberConnection("https://proxy.example.com");
    const rows = rememberConnection("https://proxy.example.com", "工作室的 Mac");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("工作室的 Mac");
  });

  it("appends a new computer and keeps the eight oldest slots", () => {
    for (let index = 0; index < 10; index += 1) rememberConnection(`http://host-${index}:8791`);
    const rows = loadConnections();
    // The order is the person's, so a new computer joins at the end and the
    // last slot is what gives way — never a row someone ranked higher.
    expect(rows).toHaveLength(8);
    expect(rows[0]?.target).toBe("http://host-0:8791");
    expect(rows[7]?.target).toBe("http://host-9:8791");
    expect(rows.map((row) => row.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("ignores a target that cannot be used", () => {
    expect(rememberConnection("")).toEqual([]);
    expect(rememberConnection("not a url")).toEqual([]);
  });

  it("moves a computer to its new port instead of adding a row", () => {
    // A desktop kernel hands out a fresh port every start; the computer is the
    // same one, so the row should follow it rather than the list growing.
    rememberConnection("http://192.168.5.3:55716", "工作台", "studio-pc");
    const rows = rememberConnection("http://192.168.5.3:61204", "工作台", "studio-pc");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target).toBe("http://192.168.5.3:61204");
    expect(rows[0]?.machine).toBe("studio-pc");
  });

  it("keeps its place when the port changes", () => {
    // The position is the person's; a restart must not push the computer down.
    rememberConnection("http://192.168.5.3:55716", "家里", "home");
    rememberConnection("https://proxy.example.com", "公司", "office");
    const rows = rememberConnection("http://192.168.5.3:61204", "家里", "home");
    expect(rows.map((row) => row.machine)).toEqual(["home", "office"]);
  });

  it("collapses the duplicates an older build left behind", () => {
    // Rows written before this rule existed carry one per port. The first
    // survives and the rest go, or the list would stay as long as it was.
    rememberConnection("http://192.168.5.3:50001", "工作台", "studio-pc");
    rememberConnection("http://192.168.5.3:50002", "工作台", "studio-pc");
    rememberConnection("http://192.168.5.3:50003", "工作台", "studio-pc");
    const rows = rememberConnection("http://192.168.5.3:61204", "工作台", "studio-pc");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target).toBe("http://192.168.5.3:61204");
  });

  it("keeps two addresses to one computer when the host differs", () => {
    // A LAN address and a tunnel naming the same machine are both usable, and
    // the person picks between them; folding them would drop a route.
    rememberConnection("http://192.168.5.2:56789", "家里", "Home Mac");
    const rows = rememberConnection("http://172.16.2.59:57074", "隧道", "Home Mac");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.target)).toEqual([
      "http://192.168.5.2:56789",
      "http://172.16.2.59:57074",
    ]);
  });

  it("does not fold a port change across two hosts", () => {
    // A port change is the same computer on the same host. A different host is
    // a different route to it — the reverse proxy, say — so it keeps its row.
    rememberConnection("https://proxy.example.com", "工作台", "studio-pc");
    const rows = rememberConnection("http://192.168.5.3:61204", "工作台", "studio-pc");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.target)).toEqual([
      "https://proxy.example.com",
      "http://192.168.5.3:61204",
    ]);
  });
});

describe("ordering", () => {
  function seed(): void {
    rememberConnection("http://home:1", "家里");
    rememberConnection("http://office:2", "公司");
    rememberConnection("https://proxy.example.com", "外面");
  }

  it("places a new computer after the ones already ranked", () => {
    seed();
    const rows = loadConnections();
    expect(rows.map((row) => row.name)).toEqual(["家里", "公司", "外面"]);
    expect(rows.map((row) => row.order)).toEqual([0, 1, 2]);
  });

  it("moves a row to a slot and renumbers the rest", () => {
    seed();
    const rows = moveConnection(connectionKey("https://proxy.example.com"), 0);
    expect(rows.map((row) => row.name)).toEqual(["外面", "家里", "公司"]);
    expect(rows.map((row) => row.order)).toEqual([0, 1, 2]);
    // The write is what a later read sees, not just the returned value.
    expect(loadConnections().map((row) => row.name)).toEqual(["外面", "家里", "公司"]);
  });

  it("lands a row dropped one slot down before the row it passed", () => {
    seed();
    // `insertAt` answers 2 when the finger is below the second row's middle;
    // the row was at 0, so it must end up second rather than third.
    const rows = moveConnection(connectionKey("http://home:1"), 2);
    expect(rows.map((row) => row.name)).toEqual(["公司", "家里", "外面"]);
  });

  it("writes nothing when a drop lands where the row already sat", () => {
    seed();
    const before = localStorage.getItem("reasonix.connections.v1");
    const rows = moveConnection(connectionKey("http://home:1"), 0);
    expect(rows.map((row) => row.name)).toEqual(["家里", "公司", "外面"]);
    expect(localStorage.getItem("reasonix.connections.v1")).toBe(before);
  });

  it("ignores a key that is not in the list", () => {
    seed();
    const rows = moveConnection(connectionKey("http://nowhere:9"), 0);
    expect(rows.map((row) => row.name)).toEqual(["家里", "公司", "外面"]);
  });

  it("clamps a drop past the end to the last slot", () => {
    seed();
    const rows = moveConnection(connectionKey("http://home:1"), 99);
    expect(rows.map((row) => row.name)).toEqual(["公司", "外面", "家里"]);
  });

  it("migrates rows written before the order existed, by recency", () => {
    localStorage.setItem(
      "reasonix.connections.v1",
      JSON.stringify([
        { kind: "lan", target: "http://old:1", name: "旧", usedAt: 10 },
        { kind: "lan", target: "https://proxy.example.com", name: "新", usedAt: 30 },
        { kind: "lan", target: "http://mid:2", name: "中", usedAt: 20 },
      ]),
    );
    const rows = loadConnections();
    // Newest first is exactly what this list meant before it had an order.
    expect(rows.map((row) => row.name)).toEqual(["新", "中", "旧"]);
    expect(rows.map((row) => row.order)).toEqual([0, 1, 2]);
  });

  it("keeps an explicit order ahead of an unnumbered row", () => {
    localStorage.setItem(
      "reasonix.connections.v1",
      JSON.stringify([
        { kind: "lan", target: "https://proxy.example.com", name: "没序号", usedAt: 99 },
        { kind: "lan", target: "http://a:1", name: "排第一", usedAt: 1, order: 0 },
        { kind: "lan", target: "http://b:2", name: "排第二", usedAt: 2, order: 1 },
      ]),
    );
    expect(loadConnections().map((row) => row.name)).toEqual(["排第一", "排第二", "没序号"]);
  });

  it("keeps the ranking when the same computer is reached again", () => {
    seed();
    moveConnection(connectionKey("https://proxy.example.com"), 0);
    // Reaching a computer is not a statement about where it belongs.
    const rows = rememberConnection("http://office:2", "公司");
    expect(rows.map((row) => row.name)).toEqual(["外面", "家里", "公司"]);
  });
});

describe("forgetting", () => {
  it("forgets one target and leaves the others", () => {
    rememberConnection("http://a:1");
    rememberConnection("http://b:2");
    const rows = forgetConnection("http://a:1/");
    expect(rows.map((row) => row.target)).toEqual(["http://b:2"]);
  });
});

describe("reading", () => {
  it("survives storage that is not a list", () => {
    localStorage.setItem("reasonix.connections.v1", "{\"nope\":true}");
    expect(loadConnections()).toEqual([]);
  });

  it("skips a row whose target is gone and coalesces duplicates", () => {
    localStorage.setItem(
      "reasonix.connections.v1",
      JSON.stringify([
        { kind: "lan", target: "http://a:1", name: "a", usedAt: 2 },
        { kind: "lan", target: "http://a:1/", name: "a again", usedAt: 1 },
        { kind: "lan", target: "", name: "x", usedAt: 3 },
        { kind: "weird", target: "http://c:3", name: "c", usedAt: 4 },
      ]),
    );
    const rows = loadConnections();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "lan", target: "http://a:1", usedAt: 2 });
  });

  it("answers the row that was connected most recently", () => {
    // Recency is `usedAt`, and two writes in the same millisecond do not order
    // each other — so the clock has to move for this to mean anything.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000));
      rememberConnection("http://a:1");
      vi.setSystemTime(new Date(2_000));
      rememberConnection("https://proxy.example.com");
    } finally {
      vi.useRealTimers();
    }
    expect(latestConnection()?.target).toBe("https://proxy.example.com");
  });

  it("answers nothing for a kind that was never recorded", () => {
    expect(latestConnection()).toBeNull();
  });
});

describe("machine identity", () => {
  it("records the computer's own name on the door it came through", () => {
    const rows = rememberConnection("http://192.168.5.2:56789", "家里", "Home Mac");
    expect(rows[0]).toMatchObject({ machine: "Home Mac" });
    // A later connect without the name must not erase it.
    const again = rememberConnection("http://192.168.5.2:56789", "家里");
    expect(again[0]?.machine).toBe("Home Mac");
  });

  it("learns a name after the door was already saved", () => {
    rememberConnection("http://192.168.5.2:56789");
    const rows = learnConnectionMachine("http://192.168.5.2:56789/", "Home Mac");
    expect(rows[0]?.machine).toBe("Home Mac");
    expect(loadConnections()[0]?.machine).toBe("Home Mac");
  });

  it("compares names the way a person reads them", () => {
    expect(machineKey("  Home   Mac ")).toBe("home mac");
    expect(machineKey(undefined)).toBe("");
  });

  it("draws two addresses of one machine as one computer", () => {
    rememberConnection("http://192.168.5.2:56789", "家里", "Home Mac");
    rememberConnection("https://proxy.example.com", "Home Mac", "home mac");
    rememberConnection("http://192.168.7.9:56789", "公司");
    const groups = groupConnections(loadConnections());
    expect(groups).toHaveLength(2);
    expect(groups[0]?.machine).toBe("Home Mac");
    expect(groups[0]?.rows.map((row) => row.target)).toEqual([
      "http://192.168.5.2:56789",
      "https://proxy.example.com",
    ]);
    expect(groups[1]?.rows).toHaveLength(1);
  });

  it("moves every door of one computer together", () => {
    rememberConnection("http://192.168.5.2:56789", "家里", "Home Mac");
    rememberConnection("https://proxy.example.com", "Home Mac", "Home Mac");
    rememberConnection("http://192.168.7.9:56789", "公司", "Office PC");
    const key = groupConnections(loadConnections())[0]!.key;
    const rows = moveConnectionGroup(key, 2);
    expect(rows.map((row) => row.machine)).toEqual(["Office PC", "Home Mac", "Home Mac"]);
  });

  it("picks the direct LAN door of the same machine only", () => {
    rememberConnection("http://192.168.5.2:56789", "家里", "Home Mac");
    rememberConnection("http://172.16.2.59:57074", "隧道", "Home Mac");
    const rows = loadConnections();
    expect(
      directDoorForMachine(rows, "home mac", ["http://192.168.5.2:56789"])?.target,
    ).toBe("http://192.168.5.2:56789");
    expect(
      directDoorForMachine(rows, "Home Mac", ["http://10.0.0.9:8791"]),
    ).toBeNull();
    expect(directDoorForMachine(rows, "Other PC", ["http://192.168.5.2:56789"])).toBeNull();
  });

  it("forgets every door when the computer is removed", () => {
    rememberConnection("http://192.168.5.2:56789", "家里", "Home Mac");
    rememberConnection("https://proxy.example.com", "Home Mac", "Home Mac");
    rememberConnection("http://192.168.7.9:56789", "公司", "Office PC");
    const key = groupConnections(loadConnections())[0]!.key;
    expect(forgetConnectionGroup(key).map((row) => row.machine)).toEqual(["Office PC"]);
  });
});

describe("isRemoteOrigin", () => {
  it("treats a neighbour address as local", () => {
    for (const origin of [
      "http://192.168.5.2:8791",
      "http://10.0.0.4:8791",
      "http://172.16.2.59:8791",
      "http://127.0.0.1:8788",
      "http://studio.local:8791",
      "http://localhost:8791",
    ]) {
      expect(isRemoteOrigin(origin), origin).toBe(false);
    }
  });

  it("treats a routed address or a name as remote", () => {
    for (const origin of [
      "https://rx.example.com:8443",
      "http://112.51.86.191:8791",
      "https://[2408:8207::1]:8443",
    ]) {
      expect(isRemoteOrigin(origin), origin).toBe(true);
    }
  });

  it("does not call a unique-local IPv6 neighbour remote", () => {
    expect(isRemoteOrigin("http://[fddd:62aa:3db::1]:8791")).toBe(false);
    expect(isRemoteOrigin("http://[fe80::1]:8791")).toBe(false);
  });
});
