#!/usr/bin/env node
/**
 * Writes the update manifest the app checks before a release.
 *
 * The manifest lives in the repository rather than only on the release: a
 * network that cannot reach GitHub directly still reads it through a mirror.
 * The APK it points at rides the Studio line's own release — the phone app
 * has no repository of its own — so the download follows that page's "latest".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = "qiyuess/reasonix-studio";
const mirrors = ["https://gh-proxy.com/", "https://ghfast.top/"];

const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const props = readFileSync(resolve(root, "android/gradle.properties"), "utf8");
const versionName = /^reasonix\.versionName=(.+)$/m.exec(props)?.[1]?.trim();
const versionCode = Number(/^reasonix\.versionCode=(\d+)$/m.exec(props)?.[1] ?? 0);

if (versionName !== version) {
  console.error(`android/gradle.properties says ${versionName ?? "nothing"}, package.json says ${version}`);
  process.exit(1);
}
if (!Number.isInteger(versionCode) || versionCode <= 0) {
  console.error("android/gradle.properties has no reasonix.versionCode");
  process.exit(1);
}

const notes = readFileSync(resolve(root, `release-notes/android/${version}.md`), "utf8")
  .replace(/\r\n/g, "\n")
  .trim();
const tag = `v${version}`;
const apk = `reasonix-for-android-${version}.apk`;
// The APK rides the Studio line's latest release; the phone app has no
// repository of its own, and the page's own "latest" link names it.
const apkUrl = `https://github.com/${repo}/releases/latest/download/${apk}`;

const manifest = {
  tag,
  version,
  versionCode,
  apk,
  notes,
  mirrors: mirrors.map((base) => base + apkUrl),
};

const next = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = readFileSync(resolve(root, "latest.json"), "utf8");
  if (current !== next) {
    console.error("latest.json is stale: run `npm run manifest` and commit the result");
    process.exit(1);
  }
  console.log(`latest.json: current (${tag}, versionCode ${versionCode})`);
} else {
  writeFileSync(resolve(root, "latest.json"), next);
  console.log(`latest.json: ${tag} (versionCode ${versionCode})`);
}
