#!/usr/bin/env node
// Writes the GitHub release body's copy of a version's notes: the Chinese half
// only.
//
// A release note carries a second language after the <!-- lang:en --> marker
// (see scripts/studio-release-notes.mjs). The GitHub page has no language
// switch, so publishing both halves there only doubles its length; the mirror
// object keeps both, because the Versions panel does switch on that marker.
//
// usage: studio-notes-zh.mjs <rendered-notes.md> <output.md>
import { appendFile, readFile } from "node:fs/promises";

const MARK = "<!-- lang:en -->";

export function chineseHalf(markdown) {
  const at = markdown.indexOf(MARK);
  let body = at < 0 ? markdown : markdown.slice(0, at);
  body = body.trimEnd();
  // The marker rides after a horizontal rule, whose only job was to separate
  // the two languages. With nothing left below it, it separates nothing.
  if (/^---$/m.test(body.split("\n").slice(-1)[0] ?? "")) {
    body = body.slice(0, body.lastIndexOf("---")).trimEnd();
  }
  return `${body}\n\n`;
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: studio-notes-zh.mjs <rendered-notes.md> <output.md>");
  process.exit(2);
}
const rendered = await readFile(input, "utf8");
await appendFile(output, chineseHalf(rendered), "utf8");
console.log(`Wrote the Chinese notes for the release page: ${input} -> ${output}`);
