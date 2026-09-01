// Type-size audit: walks the built site and reports the computed font-size,
// line-height, colour and contrast of every text-bearing element, grouped by the
// surface it belongs to. Companion to scripts/a11y-audit.mjs — that one asks whether
// text passes contrast, this one asks whether it is big enough to read at all.
//
//   npm run build && npm run type-audit
//
// Options (env): A11Y_OUT, A11Y_PORT, A11Y_BASE — same meaning as a11y-audit.mjs.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, process.env.A11Y_OUT || "reports/a11y");
const port = Number(process.env.A11Y_PORT || 4333);

const PAGES = [
  "/",
  "/docs/",
  "/docs/sdk-cli/",
  "/docs/services/s3/",
  "/support/",
  "/downloads/",
  "/releases/",
  "/console/",
  "/contributing/",
  "/404.html",
];

// Computed font sizes are in CSS px and do not move with the device pixel ratio, so the
// numbers below repeat across scale factors by design — the DPR sweep is there to render
// the same type at 1x, at Windows' 125%/150% display scaling, and at a 2x Retina/4K
// panel, and drop a screenshot of each for the thin-stroke check that no measurement
// catches. `zoomRoot` is the other axis: a reader who has set a 20px default font, and
// 200% browser zoom (which is a halved CSS viewport, not a scale factor).
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
  { name: "desktop-200pct-zoom", width: 720, height: 450 },
];
const SCALE_FACTORS = [1, 1.25, 1.5, 2, 3];
const SHOT_ROUTES = ["/", "/support/", "/docs/services/s3/"];

async function startPreview() {
  if (process.env.A11Y_BASE) return { base: process.env.A11Y_BASE.replace(/\/$/, ""), stop: async () => {} };
  const child = spawn(process.execPath, [path.join(root, "scripts", "run-command.ts"), "astro", "preview", "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://localhost:${port}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("astro preview did not start in 60s")), 60_000);
    const check = async () => {
      try {
        if ((await fetch(base + "/")).ok) {
          clearTimeout(timer);
          resolve();
          return;
        }
      } catch {
        /* not up yet */
      }
      setTimeout(check, 300);
    };
    child.on("error", reject);
    check();
  });
  return { base, stop: async () => child.kill() };
}

// Runs in the page. Every element holding its own text gets measured and labelled with
// the surface it sits on, so the report reads by area rather than by CSS selector.
const collect = () => {
  const parseColor = (value) => {
    const match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
  };
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const effectiveBg = (element) => {
    let node = element;
    let result = { r: 255, g: 255, b: 255, a: 1 };
    const stack = [];
    while (node && node !== document.documentElement.parentElement) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) stack.push(color);
      node = node.parentElement;
    }
    for (let i = stack.length - 1; i >= 0; i -= 1) result = blend(stack[i], result);
    return result;
  };
  const contrast = (fg, bg) => {
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };

  const surfaceOf = (element) => {
    if (element.closest('[aria-label="Project status"]')) return "alpha banner";
    if (element.closest("#search-panel")) return "search panel";
    if (element.closest("#mobile-menu")) return "mobile drawer";
    if (element.closest("header")) return "header / nav";
    if (element.closest("footer")) return "footer";
    if (element.closest('nav[aria-label="Breadcrumb"]')) return "breadcrumb";
    if (element.closest("aside")) return "docs sidebar";
    if (element.closest("pre")) return "code block";
    if (element.closest("table")) return "table cell";
    if (element.closest("figure")) return "diagram / figure";
    if (element.closest("figcaption")) return "caption";
    if (element.closest("dl")) return "stat tile";
    if (element.closest("[data-changelog-root]")) return "changelog";
    if (element.closest(".callout")) return "callout";
    if (element.closest(".prose")) return "docs prose";
    return "page body";
  };

  const rows = [];
  document.querySelectorAll("body *").forEach((element) => {
    const text = [...element.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent.trim())
      .join(" ")
      .trim();
    if (!text) return;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return;
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return;
    // The sr-only pattern: 1px clipped box. Not shown, so not measured.
    if (box.width <= 1 && box.height <= 1) return;
    const size = parseFloat(style.fontSize);
    const lineHeight = style.lineHeight === "normal" ? size * 1.2 : parseFloat(style.lineHeight);
    const fg = parseColor(style.color);
    const bg = effectiveBg(element);
    rows.push({
      surface: surfaceOf(element),
      tag: element.tagName.toLowerCase(),
      cls: (element.getAttribute("class") || "").slice(0, 70),
      size: Math.round(size * 100) / 100,
      lineHeight: Math.round(lineHeight * 100) / 100,
      weight: style.fontWeight,
      mono: /mono|JetBrains|Consolas|Menlo/i.test(style.fontFamily),
      width: Math.round(box.width),
      contrast: fg ? Math.round(contrast(blend(fg, bg), bg) * 100) / 100 : null,
      text: text.slice(0, 48),
    });
  });
  return rows;
};

// WCAG 1.4.3 loosens to 3:1 for "large" text — 18.66px bold or 24px — so anything
// under that has to clear 4.5:1, which is where small muted labels get caught.
const required = (row) => (row.size >= 24 || (row.size >= 18.66 && Number(row.weight) >= 700) ? 3 : 4.5);

/** Anything the page scrolls sideways at is a reflow failure (WCAG 1.4.10). */
const overflowCheck = () => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  wide: [...document.querySelectorAll("body *")]
    .filter((element) => {
      const box = element.getBoundingClientRect();
      // The known-and-wanted scrollers: code blocks and the table wrapper.
      if (element.closest(".table-scroll, pre, .code-block, [style*='overflow']")) return false;
      return box.right > document.documentElement.clientWidth + 2 && box.width > 40;
    })
    .slice(0, 6)
    .map((element) => `${element.tagName.toLowerCase()}.${(element.getAttribute("class") || "").slice(0, 50)}`),
});

async function run() {
  const { base, stop } = await startPreview();
  const browser = await chromium.launch();
  const all = [];
  const reflow = [];
  try {
    for (const viewport of VIEWPORTS) {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: theme,
        });
        const page = await context.newPage();
        for (const route of PAGES) {
          await page.goto(new URL(route, base).toString(), { waitUntil: "load" });
          const rows = await page.evaluate(collect);
          for (const row of rows) all.push({ ...row, route, theme, viewport: viewport.name });
          reflow.push({ route, theme, viewport: viewport.name, root: "16px", ...(await page.evaluate(overflowCheck)) });

          // A reader whose browser default is 20px: every rem-based size grows with it,
          // and anything pinned in px stops keeping pace. Both are worth seeing.
          await page.addStyleTag({ content: "html{font-size:20px}" });
          reflow.push({ route, theme, viewport: viewport.name, root: "20px", ...(await page.evaluate(overflowCheck)) });
        }
        await context.close();
      }
    }

    // Screenshots only — the measurements above are identical at every scale factor.
    for (const deviceScaleFactor of SCALE_FACTORS) {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          colorScheme: theme,
          deviceScaleFactor,
        });
        const page = await context.newPage();
        for (const route of SHOT_ROUTES) {
          await page.goto(new URL(route, base).toString(), { waitUntil: "load" });
          const name = `${route.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home"}-${theme}-${String(deviceScaleFactor).replace(".", "_")}x.png`;
          await mkdir(path.join(outDir, "shots"), { recursive: true });
          await page.screenshot({ path: path.join(outDir, "shots", name) });
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stop();
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "type-results.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), reflow, rows: all }, null, 2),
  );

  // Smallest type per surface, and every distinct under-size / under-contrast run.
  const bySurface = new Map();
  for (const row of all) {
    const current = bySurface.get(row.surface);
    if (!current || row.size < current.size) bySurface.set(row.surface, row);
  }

  const small = new Map();
  for (const row of all) {
    if (row.size >= 12 && row.contrast !== null && row.contrast >= required(row)) continue;
    const key = `${row.surface}|${row.size}|${row.cls}`;
    const entry = small.get(key) ?? { ...row, count: 0 };
    entry.count += 1;
    small.set(key, entry);
  }

  const lines = ["# Type audit", "", `- Generated: ${new Date().toISOString()}`, `- Measured text nodes: ${all.length}`, ""];
  lines.push("## Smallest type per surface", "", "| surface | px | line-height | mono | contrast | sample |", "| --- | --- | --- | --- | --- | --- |");
  for (const [surface, row] of [...bySurface].sort((a, b) => a[1].size - b[1].size)) {
    lines.push(`| ${surface} | ${row.size} | ${row.lineHeight} | ${row.mono ? "yes" : "no"} | ${row.contrast} | ${row.text.replace(/\|/g, "\\|")} |`);
  }
  lines.push("", "## Under 12px, or under the contrast its size requires", "", "| surface | px | contrast | needs | class | sample | seen |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of [...small.values()].sort((a, b) => a.size - b.size || b.count - a.count)) {
    lines.push(
      `| ${row.surface} | ${row.size} | ${row.contrast} | ${required(row)} | \`${row.cls}\` | ${row.text.replace(/\|/g, "\\|")} | ${row.count} |`,
    );
  }

  // Line length: 45–85 characters is the readable band; at 16px that is ~360–680px.
  lines.push("", "## Docs prose measure", "", "| route | viewport | px wide | ~chars |", "| --- | --- | --- | --- |");
  const seenMeasure = new Set();
  for (const row of all) {
    if (row.surface !== "docs prose" || row.tag !== "p") continue;
    const key = `${row.route}|${row.viewport}`;
    if (seenMeasure.has(key)) continue;
    seenMeasure.add(key);
    lines.push(`| ${row.route} | ${row.viewport} | ${row.width} | ${Math.round(row.width / (row.size * 0.5))} |`);
  }

  lines.push("", "## Horizontal reflow (WCAG 1.4.10)", "", "| route | viewport | root | scrollW | clientW | offenders |", "| --- | --- | --- | --- | --- | --- |");
  for (const entry of reflow) {
    if (entry.scrollWidth <= entry.clientWidth + 2 && entry.wide.length === 0) continue;
    lines.push(
      `| ${entry.route} | ${entry.viewport} | ${entry.root} | ${entry.scrollWidth} | ${entry.clientWidth} | ${entry.wide.join(", ") || "—"} |`,
    );
  }

  await writeFile(path.join(outDir, "type-summary.md"), lines.join("\n"));
  console.log(`Measured ${all.length} text nodes. Smallest per surface:`);
  for (const [surface, row] of [...bySurface].sort((a, b) => a[1].size - b[1].size)) {
    console.log(`  ${String(row.size).padStart(5)}px  ${surface}`);
  }
  console.log(`\n${small.size} distinct undersized / low-contrast runs. Report: ${outDir}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
