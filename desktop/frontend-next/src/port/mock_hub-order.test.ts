// @vitest-environment jsdom
import { expect, it } from "vitest";
import { MockHub } from "./mock_hub";

it("keeps session placement and pin/archive flags in the same mock tree", async () => {
  const hub = new MockHub();
  const original = (await hub.tree())[0].sessions;
  const [first, second] = original;
  await hub.pinSession(second.path, true);
  await hub.moveSession(second.path, -1);
  const moved = (await hub.tree())[0].sessions;
  expect(moved.map((s) => s.path)).toEqual([second.path, first.path]);
  expect(moved[0].pinned).toBe(true);
  await hub.archiveSession(second.path, true);
  const archived = (await hub.tree())[0].sessions;
  expect(archived.map((s) => s.path)).toEqual([second.path, first.path]);
  expect(archived[0]).toMatchObject({ archived: true, pinned: false });
});

it("retains seeded history while closing and reopening its pane with a fresh identity", async () => {
  const hub = new MockHub(3);
  const original = (await hub.runtimes())[1];
  await hub.close(original.id);
  const closed = (await hub.tree()).flatMap((workspace) => workspace.sessions).find((session) => session.path === original.sessionPath);
  expect(closed).toBeDefined();
  expect(closed?.runtimeId).toBeUndefined();
  const reopened = await hub.open({ root: original.root, sessionPath: original.sessionPath });
  expect(reopened.id).not.toBe(original.id);
  expect((await hub.runtimes()).find((runtime) => runtime.id === reopened.id)?.sessionPath).toBe(original.sessionPath);
  expect((await hub.tree()).flatMap((workspace) => workspace.sessions).find((session) => session.path === original.sessionPath)?.runtimeId).toBe(reopened.id);
});

// The fixture answers the same way the kernel does, or a test written against
// it proves something the product does not do. A folder that already reads by
// a name keeps it: re-adding it is not a rename.
it("keeps the name a listed project already has", async () => {
  const hub = new MockHub();
  const root = "/work/shop-web";
  await hub.addWorkspace(root, undefined, "orders");
  const renamed = await hub.addWorkspace(root, undefined, "something else");
  expect(renamed.displayName).toBe("orders");

  const row = (await hub.tree()).find((ws) => ws.root === root);
  expect(row?.displayName).toBe("orders");
});

// An unnamed folder has not answered yet, so the name it is added with is its
// first answer — the same rule the kernel applies.
it("names a listed project that has none yet", async () => {
  const hub = new MockHub();
  const root = "/work/shop-api";
  await hub.addWorkspace(root);
  const named = await hub.addWorkspace(root, undefined, "orders");
  expect(named.displayName).toBe("orders");
});
