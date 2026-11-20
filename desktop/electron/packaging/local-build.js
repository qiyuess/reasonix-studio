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

function run(entry, args, env) {
  // Through node and an argument array, never through a shell: on Windows a
  // shell re-reads the command line and drops arguments, which once cost a
  // build its `--win nsis` and its injected version at the same time.
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: HERE,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
  return result.status === 0 ? (result.stdout || "").trim() : "";
}

// --build-version is this script's; the rest is electron-builder's. Named apart
// from --version so electron-builder's own use of that flag still passes through.
const argv = process.argv.slice(2);
let stated = "";
let statedMissing = false;
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
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
// `--config.`, not `-c.`. electron-builder parses its command line with yargs,
// and a one-letter option is read as a short flag: `-c.extraMetadata.version=…`
// arrives as the string in `argv.c`, which nothing reads, so extraMetadata stays
// empty and the bundle ships 0.0.0 while the log still prints the version it was
// told. Only the long name expands the dotted path into an object — verified
// against the yargs this build resolves to.
run(require.resolve("electron-builder/cli.js"), [...passthrough, `--config.extraMetadata.version=${number}`]);
