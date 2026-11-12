"use strict";
// Rasterises public/icons/icon.svg into the sizes the manifest and the
// apple-touch link name. The SVG is the only source; the PNGs beside it are
// outputs — the same rule desktop/electron/packaging/icons.js follows for the
// shell's own icons, and the reason both live beside their sources.
//
// Run it from desktop/frontend-next:  node tools/icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ICONS = join(HERE, "..", "public", "icons");

// The manifest names the first three; index.html names the apple-touch one.
const OUT = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
];

async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const svg = readFileSync(join(ICONS, "icon.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  for (const [name, size] of OUT) {
    writeFileSync(join(ICONS, name), await render(page, svg, size));
    console.log(`wrote ${name} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
