import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const indexScript = path.join(dir, "update-versions-index.sh");
const backfill = path.join(dir, "backfill-studio-notes.sh");
const workflow = readFileSync(path.join(dir, "..", ".github", "workflows", "release-studio.yml"), "utf8");

function index(existing, ...args) {
  const run = spawnSync("bash", [indexScript, existing, ...args], { encoding: "utf8" });
  return { status: run.status, stderr: run.stderr, json: run.status === 0 ? JSON.parse(run.stdout) : null };
}

const NOTES = "https://qiyuess.github.io/reasonix-studio/studio/notes/2.32.0.md";

test("an entry carries notes only when a notes address is given", () => {
  const withNotes = index("-", "v2.32.0", "studio-v2.32.0", "studio", "2026-10-09T00:00:00Z", "20", NOTES);
  assert.equal(withNotes.json.versions[0].notes, NOTES);
  const without = index("-", "v2.32.0", "studio-v2.32.0", "studio", "2026-10-09T00:00:00Z");
  assert.equal("notes" in without.json.versions[0], false);
});

test("a notes address outside the notes prefix is refused", () => {
  for (const bad of ["https://example.com/2.32.0.md", "https://dl.reasonix.io/studio-v2.32.0/latest.json"]) {
    const run = index("-", "v2.32.0", "studio-v2.32.0", "studio", "2026-10-09T00:00:00Z", "20", bad);
    assert.notEqual(run.status, 0);
  }
});

test("a rerun never rewrites an existing entry, notes included", () => {
  const first = index("-", "v2.32.0", "studio-v2.32.0", "studio", "2026-10-09T00:00:00Z");
  const dirPath = mkdtempSync(path.join(tmpdir(), "idx-"));
  const file = path.join(dirPath, "c.json");
  writeFileSync(file, JSON.stringify(first.json));
  const again = index(file, "v2.32.0", "studio-v2.32.0", "studio", "2026-10-10T00:00:00Z", "20", NOTES);
  assert.equal(again.json.versions.length, 1);
  assert.equal("notes" in again.json.versions[0], false);
});

test("the release writes a version's notes before the catalog that names them", () => {
  const step = workflow.slice(workflow.indexOf("Publish the update catalog"));
  const at = (needle) => {
    const i = step.indexOf(needle);
    assert.notEqual(i, -1, needle);
    return i;
  };
  const notes = at('cp "$RUNNER_TEMP/version-notes.md" "$site/studio/notes/');
  const merge = at("scripts/update-versions-index.sh");
  assert.ok(notes < merge, "notes are written before the catalog entry that names them");
  assert.match(step.slice(merge), /studio\/notes\/\$\{VERSION#v\}\.md/);
});

// The site is committed once: a catalog entry naming a notes object that never
// reached the branch cannot exist, because both travel in the same commit.
test("the notes and the catalog that names them land in one commit", () => {
  const step = workflow.slice(workflow.indexOf("Publish the update catalog"));
  const commit = step.indexOf('git commit -q -m "release: $TAG"');
  const push = step.indexOf("git push --quiet origin gh-pages");
  assert.notEqual(commit, -1, "the step commits the site");
  assert.notEqual(push, -1, "the step pushes the site");
  assert.ok(commit < push, "the commit is pushed after it is made");
  assert.match(step.slice(0, commit), /add -A/);
  assert.doesNotMatch(step.slice(commit, push), /update-versions-index\.sh/);
});

// A candidate's manifest and notes are published so it can be installed and
// tested, but it must not enter the catalog every running install reads.
test("a candidate publishes its manifest without entering the catalog", () => {
  const step = workflow.slice(workflow.indexOf("Publish the update catalog"));
  const candidate = step.indexOf('if [ "$CANDIDATE" = "true" ]');
  const merge = step.indexOf("scripts/update-versions-index.sh");
  assert.notEqual(candidate, -1);
  assert.notEqual(merge, -1);
  assert.ok(candidate < merge, "the candidate branch is decided before the catalog is merged");
  const branch = step.slice(candidate, merge);
  assert.doesNotMatch(branch, /versions\.json/, "the catalog is untouched");
  // The manifest and the notes are written before that branch, so a candidate
  // still publishes both; only the catalog entry is skipped.
  const before = step.slice(0, candidate);
  assert.match(before, /cp dist\/latest\.json/, "the manifest still ships");
  assert.match(before, /cp "\$RUNNER_TEMP\/version-notes\.md"/, "the notes still ship");
});



test("stable publications deploy from website without widening Pages or signing permissions", () => {
  const job = workflow.match(/^  website:\n[\s\S]*?(?=^  [a-z][a-z-]*:|$(?![\s\S]))/m)?.[0] ?? "";
  assert.match(job, /needs: \[resolve, publish\]/);
  assert.match(job, /github\.repository == 'esengine\/DeepSeek-Reasonix'/);
  assert.match(job, /needs\.resolve\.outputs\.candidate != 'true'/);
  assert.match(job, /actions: write/);
  assert.doesNotMatch(job, /id-token:|pages:|secrets:/);
  assert.match(job, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(job, /VERSION: \$\{\{ needs\.resolve\.outputs\.version \}\}/);
  assert.match(job, /scripts\/publish-studio-changelog\.sh/);
  const registration = readFileSync(path.join(dir, "..", ".github", "workflows", "pages.yml"), "utf8");
  assert.match(registration, /workflow_dispatch:/);
  for (const input of ["release_version", "release_request", "studio_version"]) assert.ok(registration.includes(`${input}:`));
  assert.match(registration, /permissions: \{\}/);
  assert.match(registration, /exit 1/);
});

test("website publication waits for its own deployment and propagates dispatch, API and deployment failures", () => {
  const root = mkdtempSync(path.join(tmpdir(), "website-publish-"));
  const calls = path.join(root, "calls");
  writeFileSync(path.join(root, "gh"), `#!/bin/sh
echo "$*" >> "$CALLS"
case "$1" in
  workflow) exit "$DISPATCH_STATUS" ;;
  api) [ "$API_STATUS" = 0 ] || exit "$API_STATUS"; printf '%s' "$RUN_ID" ;;
  run) exit "$WATCH_STATUS" ;;
  *) exit 99 ;;
esac
`);
  chmodSync(path.join(root, "gh"), 0o755);
  writeFileSync(path.join(root, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(path.join(root, "sleep"), 0o755);
  const run = (extra = {}) => spawnSync("bash", [path.join(dir, "publish-studio-changelog.sh")], {
    encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CALLS: calls,
      GITHUB_REPOSITORY: "example/reasonix", GITHUB_RUN_ID: "456", GITHUB_RUN_ATTEMPT: "2", VERSION: "v2.45.0",
      DISPATCH_STATUS: "0", API_STATUS: "0", WATCH_STATUS: "0", RUN_ID: "123", ...extra },
  });
  assert.equal(run().status, 0);
  const log = readFileSync(calls, "utf8");
  assert.match(log, /workflow run pages\.yml --repo example\/reasonix --ref website/);
  assert.match(log, /studio_version=2\.45\.0/);
  assert.match(log, /release_request=studio-456-2/);
  assert.match(log, /endswith\(" \[studio-456-2\]"\)/);
  assert.match(log, /run watch 123 .*--exit-status/);
  for (const extra of [{ DISPATCH_STATUS: "1" }, { API_STATUS: "1" }, { WATCH_STATUS: "1" }, { RUN_ID: "" }, { VERSION: "v2.46.0-preview.1" }]) {
    assert.notEqual(run(extra).status, 0, JSON.stringify(extra));
  }
});

// The site is a git branch, so the sandbox is a repository rather than a
// bucket: the script clones it, writes notes into the clone, and pushes.
function sandbox({ catalog, notes = {}, busy = "0", tags }) {
  const root = mkdtempSync(path.join(tmpdir(), "bf-"));
  const site = path.join(root, "site");
  const bin = path.join(root, "bin");
  const repo = path.join(root, "repo");
  mkdirSync(site, { recursive: true });
  mkdirSync(bin);
  mkdirSync(repo);

  const add = (base, rel, body) => {
    mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    writeFileSync(path.join(base, rel), body);
  };
  add(site, "studio/versions.json", JSON.stringify(catalog));
  for (const [rel, body] of Object.entries(notes)) add(site, rel, body);

  const gitIn = (dir, ...a) =>
    spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });

  gitIn(site, "init", "-q");
  gitIn(site, "checkout", "-q", "-b", "gh-pages");
  gitIn(site, "add", ".");
  gitIn(site, "commit", "-q", "-m", "site");
  // Leave gh-pages: a repository refuses a push into the branch it has checked
  // out, and the script pushes into it.
  gitIn(site, "checkout", "-q", "-b", "staging");

  const shim = (name, body) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  shim("gh", `echo "${busy}"`);
  shim("node", `mkdir -p "$(dirname "$3")"; cp "$2" "$3"; printf '\\nrendered\\n' >> "$3"`);

  gitIn(repo, "init", "-q");
  for (const v of tags) {
    add(repo, `release-notes/studio/${v}.md`, `notes ${v}\n`);
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-q", "-m", v);
    gitIn(repo, "tag", `studio-v${v}`);
  }

  const run = (...args) =>
    spawnSync("bash", [backfill, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKFILL_REPO: repo, SITE_REPO: site },
    });
  // Read what actually landed on the branch, not the working tree: the script
  // pushes into gh-pages, which this sandbox deliberately does not have checked
  // out (git refuses that push).
  const read = (rel) => {
    const r = gitIn(site, "show", `gh-pages:${rel}`);
    return r.status === 0 ? r.stdout : null;
  };
  const commits = () => gitIn(site, "rev-list", "--count", "gh-pages").stdout.trim();
  return { run, read, commits };
}

const entry = (v, extra = {}) => ({ version: `v${v}`, tag: `studio-v${v}`, channel: "studio", publishedAt: "2026-10-01T00:00:00Z", manifest: `https://qiyuess.github.io/reasonix-studio/studio-v${v}/latest.json`, ...extra });
const catalog = () => ({ schemaVersion: 1, updatedAt: "x", versions: [entry("2.3.0"), entry("2.2.0"), entry("2.1.0", { notes: "https://qiyuess.github.io/reasonix-studio/studio/notes/2.1.0.md" })] });

test("the backfill is a dry run unless asked, and writes nothing", () => {
  const s = sandbox({ catalog: catalog(), tags: ["2.3.0"] });
  const before = s.read("studio/versions.json");
  const count = s.commits();
  const run = s.run();
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /would write 2\.3\.0/);
  assert.match(run.stdout, /no notes 2\.2\.0/);
  assert.equal(s.read("studio/notes/2.3.0.md"), null);
  assert.equal(s.read("studio/versions.json"), before);
  assert.equal(s.commits(), count, "a dry run commits nothing");
});

test("apply writes the missing notes, skips what exists, and leaves a version without a file bare", () => {
  const s = sandbox({ catalog: catalog(), notes: { "studio/notes/2.2.0.md": "kept\n" }, tags: ["2.3.0", "2.2.0"] });
  const run = s.run("--apply");
  assert.equal(run.status, 0, run.stderr);
  assert.match(s.read("studio/notes/2.3.0.md"), /rendered/);
  assert.equal(s.read("studio/notes/2.2.0.md"), "kept\n");
  const next = JSON.parse(s.read("studio/versions.json"));
  const byVersion = Object.fromEntries(next.versions.map((e) => [e.version, e]));
  assert.equal(byVersion["v2.3.0"].notes, "https://qiyuess.github.io/reasonix-studio/studio/notes/2.3.0.md");
  assert.equal(byVersion["v2.2.0"].notes, "https://qiyuess.github.io/reasonix-studio/studio/notes/2.2.0.md");
  assert.equal(byVersion["v2.1.0"].notes, "https://qiyuess.github.io/reasonix-studio/studio/notes/2.1.0.md");
});

test("a version with no notes file gets no field", () => {
  const s = sandbox({ catalog: catalog(), tags: ["2.3.0"] });
  assert.equal(s.run("--apply").status, 0);
  const next = JSON.parse(s.read("studio/versions.json"));
  assert.equal("notes" in next.versions.find((e) => e.version === "v2.2.0"), false);
});

test("apply refuses while a release run is in progress and touches nothing", () => {
  const s = sandbox({ catalog: catalog(), tags: ["2.3.0"], busy: "1" });
  const before = s.read("studio/versions.json");
  const run = s.run("--apply");
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /in progress/);
  assert.equal(s.read("studio/notes/2.3.0.md"), null);
  assert.equal(s.read("studio/versions.json"), before);
});
