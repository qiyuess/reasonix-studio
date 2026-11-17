import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const verify = fileURLToPath(new URL("verify-studio-artifacts.sh", import.meta.url));

// This line publishes one Studio artifact, the Windows amd64 installer. The
// phone app rides in the same release but is named after the phone project's
// version, so it is not this checker's business.
const installer = "ReasonixStudio-windows-amd64-installer.exe";

// Packages the release no longer builds. A reappearing one means the release
// grew a leg nothing signs or verifies, so the checker refuses it.
const strays = ["amd64", "arm64"].flatMap((arch) => [
  `ReasonixStudio-linux-${arch}.deb`, `ReasonixStudio-linux-${arch}.rpm`, `ReasonixStudio-linux-${arch}.AppImage`,
  `ReasonixStudio-windows-${arch}.zip`,
  `ReasonixStudio-darwin-${arch}.dmg`, `ReasonixStudio-darwin-${arch}.zip`,
]).concat(["ReasonixStudio-windows-arm64-installer.exe"]);

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-artifacts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, installer), "package fixture");
  return dir;
}

// MSYS bash resolves a Windows path for `test -s` but not inside compgen's
// glob, so the directory is handed over in the form bash itself speaks.
function posixDir(dir) {
  if (process.platform !== "win32") return dir;
  const converted = spawnSync("cygpath", ["-u", dir], { encoding: "utf8" });
  assert.equal(converted.status, 0, `cygpath could not translate ${dir}: ${converted.stderr}`);
  return converted.stdout.trim();
}

const run = (dir) => spawnSync("bash", [verify, posixDir(dir)], { encoding: "utf8" });

test("the Windows amd64 installer is what publication requires", (t) => {
  assert.equal(run(fixture(t)).status, 0);
});

test("a missing installer is a failed publication, however many signatures sit beside it", (t) => {
  const dir = fixture(t);
  fs.unlinkSync(path.join(dir, installer));
  fs.writeFileSync(path.join(dir, installer + ".minisig"), "signature");
  const result = run(dir);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(installer));
});

test("an empty installer is a failed publication", (t) => {
  const dir = fixture(t);
  fs.truncateSync(path.join(dir, installer));
  const result = run(dir);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(installer));
});

for (const name of strays) {
  test(`a ${name} beside the installer is refused rather than published`, (t) => {
    const dir = fixture(t);
    fs.writeFileSync(path.join(dir, name), "package fixture");
    const result = run(dir);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes("unexpected Studio artifact"));
  });
}
