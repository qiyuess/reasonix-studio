"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Packaging this shell locally answers the same two questions the release
// workflow does, and it has to answer both: which version this build is, and
// where that version gets written. The tree carries 0.0.0 in package.json and
// no number anywhere else, so a run that states neither produces an installer
// whose FileVersion is 0.0.0 — a shell that ranks behind every published
// release and offers itself an update on every launch. The kernel needs the
// same number for a different reason: the routes that install a kernel on
// another machine name a release by it, and "dev" is refused before anything
// reaches the network.
//
// The number is never read out of the tree. It comes from --build-version,
// then REASONIX_VERSION, then the newest studio-v tag — and that tag only when
// HEAD *is* it. A tree four commits past 2.70.0 is not 2.70.0, so rather than
// mint a number nothing carries, this refuses and says which tag it saw.
//
// Everything else on the command line belongs to electron-builder:
//   pnpm run pack -- --win nsis --build-version 2.71.0
const HERE = path.join(__dirname, "..");
const REPO = path.join(HERE, "..", "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(entry, args, env, cwd = HERE) {
  // Through node and an argument array, never through a shell: on Windows a
  // shell re-reads the command line and drops arguments, which once cost a
  // build its `--win nsis` and its injected version at the same time.
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
  return result.status === 0 ? (result.stdout || "").trim() : "";
}

// electron-builder revalidates its download against SHASUMS256.txt on every run,
// which needs GitHub and fails after 34s when the network stalls. pnpm has
// already unpacked the same Electron under node_modules, so a local build points
// at it instead. Reusing a dist that does not match would ship the wrong shell
// silently, so two things are checked first: the version it states, and the
// machine its executable was built for.
//
// The architecture is only readable on Windows here — that is where a local
// build of this shell runs today, and reading it elsewhere would need a
// different reader per platform. On other hosts the version check stands alone
// rather than pretending to have checked more.
function electronDistFlag(arch = targetArch()) {
  const fs = require("node:fs");
  const dist = path.join(HERE, "node_modules", "electron", "dist");
  const wanted = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).devDependencies?.electron;
  if (!wanted || !fs.existsSync(dist)) return "";
  const actual = fs.readFileSync(path.join(dist, "version"), "utf8").trim();
  if (actual !== wanted) {
    console.log(`electron: local dist is ${actual}, wanted ${wanted}; letting electron-builder fetch it`);
    return "";
  }
  const exe = path.join(dist, "electron.exe");
  if (process.platform === "win32" && fs.existsSync(exe)) {
    const want = require("./pe.js").MACHINE[arch === "x64" ? "amd64" : arch];
    const got = peMachineOf(exe);
    if (want !== undefined && got !== 0 && got !== want) {
      console.log(`electron: local dist is 0x${got.toString(16)}, wanted ${arch}; letting electron-builder fetch it`);
      return "";
    }
  }
  return `--config.electronDist=${path.relative(HERE, dist).replace(/\\/g, "/")}`;
}

// targetArch is the architecture this run builds for: electron-builder takes it
// from the flags it was handed, and otherwise from the machine doing the build.
function targetArch(flags = passthrough) {
  if (flags.includes("--arm64")) return "arm64";
  if (flags.includes("--x64")) return "x64";
  return process.arch === "arm64" ? "arm64" : "x64";
}

// peMachineOf reads a PE image's machine field without slurping the binary: the
// COFF header sits near the front of the file.
function peMachineOf(file) {
  const fs = require("node:fs");
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(4096);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    if (read < 0x40 || head.readUInt16LE(0) !== 0x5a4d) return 0;
    const at = head.readUInt32LE(0x3c);
    if (at + 6 > read) return 0;
    return head.readUInt16LE(at + 4);
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// The interface ships as built output under `desktop/frontend-next/dist`, which
// electron-builder copies in as a resource. Nothing rebuilt it, so a packaging
// run shipped whatever day that output was last written: the kernel and the
// version were current, and only the window was old. Whoever is running this has
// the sources; build them.
function buildFrontend() {
  const app = path.join(REPO, "desktop", "frontend-next");
  if (!require("node:fs").existsSync(path.join(app, "package.json"))) {
    fail(`no SPA to build at ${app}`);
  }
  run(path.join(app, "node_modules", "vite", "bin", "vite.js"), ["build"], {}, app);
}

// Built output older than the sources it was built from is the same bug caught a
// second way: a build that silently kept an old `dist/` would ship a window that
// answers yesterday's questions.
function checkFrontendIsCurrent() {
  const fs = require("node:fs");
  const app = path.join(REPO, "desktop", "frontend-next");
  const out = path.join(app, "dist", "index.html");
  if (!fs.existsSync(out)) fail("the SPA was not built: no dist/index.html");
  const built = fs.statSync(out).mtimeMs;
  const stale = newestSourceMtime(path.join(app, "src"));
  if (stale > built) {
    fail(
      `the built SPA is older than its sources by ${Math.round((stale - built) / 1000)}s.\n` +
        "  The installer would carry a window without the fixes in src/.",
    );
  }
  console.log("bundle carries a freshly built SPA");
}

function newestSourceMtime(dir) {
  const fs = require("node:fs");
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestSourceMtime(at) : fs.statSync(at).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

// The bundle is asked what version it carries, rather than trusted to have taken
// the one it was handed. The asar header is read directly — index, then file —
// so this needs no dependency of its own.
function checkPackagedVersion(expected) {
  const fs = require("node:fs");
  const app = path.join(REPO, "dist", "win-unpacked", "resources", "app.asar");
  if (!fs.existsSync(app)) return; // nothing unpacked: not a win `--dir`/nsis run

  const fd = fs.openSync(app, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    if (head.readUInt32LE(0) !== 4) fail("app.asar does not start with an asar header");
    const headerSize = head.readUInt32LE(12);
    const header = Buffer.alloc(headerSize);
    fs.readSync(fd, header, 0, headerSize, 16);
    const index = JSON.parse(header.toString("utf8"));
    const entry = index.files?.["package.json"];
    // `offset` arrives as a string of digits in an asar index, not a number, and
    // the bytes it points at carry a small length prefix before the JSON.
    if (!entry || entry.offset === undefined) fail("app.asar carries no package.json");
    const window = Buffer.alloc(entry.size + 16);
    fs.readSync(fd, window, 0, window.length, 16 + headerSize + Number(entry.offset));
    const at = window.indexOf(0x7b); // "{"
    if (at < 0) fail("app.asar's package.json does not start with JSON");
    const text = window.subarray(at).toString("utf8");
    const carried = JSON.parse(text.slice(0, text.lastIndexOf("}") + 1)).version;
    if (carried !== expected) {
      fail(
        `the bundle carries ${carried}, not ${expected}: the version flag did not land.\n` +
          "  Something before it on electron-builder's command line ended the option list.\n" +
          "  Do not ship installers from this run.",
      );
    }
    console.log(`bundle carries version ${carried}`);
  } finally {
    fs.closeSync(fd);
  }
}

// --build-version is this script's; the rest is electron-builder's. Named apart
// from --version so electron-builder's own use of that flag still passes through.
const argv = process.argv.slice(2);
let stated = "";
let statedMissing = false;
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  // pnpm hands the script a bare `--` to separate its own flags from these. It
  // must not reach electron-builder: yargs reads `--` as the end of options and
  // takes everything after it as positional arguments, which is how the version
  // flag below once stopped landing.
  if (arg === "--") continue;
  if (arg === "--build-version") {
    // A flag with nothing after it is a mistake, not a request to go guessing:
    // falling back to the tag here is how a build ships a number nobody chose.
    // A following flag is that same mistake — swallowing it would also lose it
    // from what electron-builder is handed.
    const next = argv[i + 1] ?? "";
    if (!next.trim() || next.startsWith("-")) statedMissing = true;
    else { stated = next; i++; }
  } else if (arg.startsWith("--build-version=")) {
    stated = arg.slice("--build-version=".length);
    if (!stated.trim()) statedMissing = true;
  } else passthrough.push(arg);
}

// A number a person states is written both ways in the wild — with the tag's
// prefix and without — so the prefix is stripped wherever it comes from.
const bare = (value) => value.trim().replace(/^v/, "");

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function version() {
  if (statedMissing) return "";
  if (stated.trim()) return bare(stated);
  if ((process.env.REASONIX_VERSION || "").trim()) return bare(process.env.REASONIX_VERSION);
  const newest = git(["describe", "--tags", "--abbrev=0", "--match", "studio-v*"]);
  if (!newest) return "";
  // Only a HEAD sitting on the tag names a number this tree actually is.
  const exact = git(["describe", "--tags", "--exact-match", "--match", "studio-v*"]);
  return exact === newest ? newest.replace(/^studio-v/, "") : "";
}

const number = version();
if (!SEMVER.test(number) || number === "0.0.0") {
  fail(
    (statedMissing ? "--build-version was given no number.\n" : "") +
      "no version to package: nothing here can state what this build is.\n" +
      `  pass --build-version X.Y.Z, set REASONIX_VERSION, or package a tagged commit.\n` +
      `  newest studio-v tag: ${git(["describe", "--tags", "--abbrev=0", "--match", "studio-v*"]) || "(none)"}\n` +
      `  this HEAD:           ${git(["describe", "--tags", "--always"]) || "(not a git checkout)"}`,
  );
}

console.log(`packaging Reasonix Studio ${number}`);
// The kernel spells it with the tag's prefix; the bundle carries the bare
// number electron's app.getVersion() reports.
run(path.join(HERE, "packaging", "build-host.js"), [], { REASONIX_VERSION: `v${number}` });
// The SPA is copied into the bundle from its built output, which nothing here
// used to rebuild. A shell wrapped around a `dist/` from some earlier day leaves
// every interface fix in the source and none in the installer — and nothing says
// so: the kernel is fresh, the version is right, and only the window is old.
buildFrontend();
const distFlag = electronDistFlag();
// The version goes in the file name for a local build only. The release workflow
// signs, checksums and records the installer by its exact name in ten places, so
// its spelling is a contract; on one disk, though, two builds called the same
// thing cannot be told apart.
run(require.resolve("electron-builder/cli.js"), [
  ...passthrough,
  ...(distFlag ? [distFlag] : []),
  `--config.win.artifactName=ReasonixStudio-windows-\${arch}-${number}.\${ext}`,
  `--config.nsis.artifactName=ReasonixStudio-windows-\${arch}-${number}-installer.\${ext}`,
  `--config.extraMetadata.version=${number}`,
]);
checkPackagedVersion(number);
checkFrontendIsCurrent();
