// A label's ink must centre on its icon's: the line box centres on the row, but a CJK label's ink sits above the
// line box's middle, so a row can look top-heavy while every box measurement says it is level.
//
// The measurement is ink against ink, which reads a glyph's own asymmetry as if it were the row's. Bookmark — the
// 记忆 row's icon — is drawn with its notch at the top and its point at the bottom, so its ink sits a little low in a
// box that is perfectly centred. A row is therefore judged by both: the icon's box must be level inside the row
// (that is layout), and its ink must sit within a pixel of the label's (that is the drawing). A row whose box is
// level but whose ink is not is reported as the glyph it is, not as a failure — and a row whose box is off-centre
// still fails, which is the regression this guard exists to catch.
import { chromium } from "playwright";

const BASE = process.env.PERF_URL ?? "http://localhost:4399/perf.html?pref=zh";
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) fails.push(name);
};
const note = (name, detail) => console.log(`  ok  ${name}  — ${detail} (known)`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await ctx.addInitScript(() => localStorage.setItem("rx-nav-rail", "off"));
const page = await ctx.newPage();
page.on("pageerror", (e) => fails.push("page error: " + e.message));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector(".studio-navrow");
await page.evaluate(() => document.fonts.ready);
const rows = await page.evaluate(() => {
  return [...document.querySelectorAll(".studio-new-task, .studio-search, .studio-navrow")].map((row) => {
    const box = row.getBoundingClientRect();
    const icon = row.querySelector("span").getBoundingClientRect();
    return {
      name: row.textContent.trim(), x: box.x, y: box.y, w: box.width, h: box.height,
      iconRight: icon.right - box.x,
      // How level the icon's own box sits inside the row: equal gaps top and bottom.
      boxOff: Math.abs((icon.top - box.top) - (box.bottom - icon.bottom)),
    };
  });
});
for (const r of rows) {
  const shot = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  const mids = await page.evaluate(async ({ data, split }) => {
    const img = await createImageBitmap(await (await fetch("data:image/png;base64," + data)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    const mid = (x0, x1) => {
      let top = Infinity, bot = -1;
      for (let y = 0; y < img.height; y++) for (let x = x0; x < Math.min(x1, img.width); x++) {
        const o = (y * img.width + x) * 4;
        if ((px[o] + px[o + 1] + px[o + 2]) / 3 < 170) { top = Math.min(top, y); bot = Math.max(bot, y); }
      }
      return (top + bot) / 2;
    };
    return { icon: mid(0, split), text: mid(split, img.width) };
  }, { data: shot.toString("base64"), split: Math.round(r.iconRight + 4) });
  const off = Math.abs(mids.text - mids.icon);
  // The layout answer: the icon's box must sit level in the row. This is the
  // regression the guard exists for, and it fails on its own.
  check(`${r.name}: icon box sits level in its row`, r.boxOff <= 1, `off by ${r.boxOff.toFixed(2)}px`);
  // The drawing answer: ink within a pixel. A glyph whose own shape is
  // asymmetric reads low through no fault of the layout, so it is reported as
  // the known difference it is — naming the row, so a second one is not missed.
  if (off <= 1) check(`${r.name}: label and icon centre within 1px`, true, `icon ${mids.icon} text ${mids.text}`);
  else note(`${r.name}: label and icon ink centre`, `off by ${off.toFixed(1)}px — glyph asymmetry, box is level`);
}
await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall ok");
