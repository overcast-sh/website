// Accessibility audit: runs axe-core (WCAG 2.2 A/AA) over every page in the built
// sitemap, in both themes, at desktop and phone widths, plus the interactive states
// axe can't reach on its own (search panel open, mobile drawer open, an expanded
// release accordion).
//
// Usage:
//   npm run build            # produces dist/ + dist/sitemap.xml
//   npm run a11y             # serves dist/ and audits it
//
// Options (env):
//   A11Y_OUT=<dir>     where the JSON + markdown report land (default: reports/a11y)
//   A11Y_PORT=<n>      preview port (default 4331)
//   A11Y_LIMIT=<n>     audit only the first N sitemap URLs (smoke runs)
//   A11Y_URLS=a,b,c    audit exactly these paths instead of the sitemap
//   A11Y_BASE=<url>    audit an already-running server instead of starting one
//   A11Y_FULL=1        every page in every theme × viewport (slow; the default
//                      sweeps every page once and then one page per page class
//                      through every theme × viewport, which is the same coverage
//                      for a template-driven site at a fraction of the runtime)
//
// Exit code is 1 when any violation is found, so CI can gate on it.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, process.env.A11Y_OUT || "reports/a11y");
const port = Number(process.env.A11Y_PORT || 4331);
const limit = process.env.A11Y_LIMIT ? Number(process.env.A11Y_LIMIT) : Infinity;

// WCAG 2.2 AA, plus the ARIA rules axe files separately from the WCAG tags — a broken
// combobox or listbox fails 4.1.2 in practice even when axe tags the rule "best-practice".
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

// Two axes of theming: the OS preference (media query) and the site's own toggle,
// which stamps data-theme on <html> and wins over the media query in both directions.
const THEMES = [
  { name: "light-os", colorScheme: "light", dataTheme: null },
  { name: "dark-os", colorScheme: "dark", dataTheme: null },
  { name: "light-toggle", colorScheme: "dark", dataTheme: "light" },
  { name: "dark-toggle", colorScheme: "light", dataTheme: "dark" },
];

/** Extra interactive states, applied after load. `when` decides which pages get them. */
const STATES = [
  { name: "default", apply: async () => {} },
  {
    name: "search-open",
    when: () => true,
    apply: async (page) => {
      await page.click("#search-open");
      await page.waitForSelector("#search-overlay:not(.hidden)");
      await page.fill("#search-input", "s3");
      // Results are debounced and pagefind loads lazily; wait for rendered rows.
      await page.waitForSelector("#search-results [data-result], #search-results div", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
  },
  {
    name: "menu-open",
    when: (_url, viewport) => viewport.name === "mobile",
    apply: async (page) => {
      await page.click("#menu-toggle");
      await page.waitForSelector("#mobile-menu:not(.hidden)");
    },
  },
  {
    name: "release-expanded",
    when: (url) => url.endsWith("/releases/"),
    apply: async (page) => {
      await page.evaluate(() => {
        document.querySelectorAll("details").forEach((d) => {
          d.open = true;
        });
      });
      await page.waitForTimeout(150);
    },
  },
  {
    name: "docs-drawer-open",
    when: (url, viewport) => viewport.name === "mobile" && /\/docs\/.+/.test(new URL(url).pathname),
    apply: async (page) => {
      await page.evaluate(() => {
        const drawer = document.querySelector("aside details");
        if (drawer) drawer.open = true;
      });
      await page.waitForTimeout(150);
    },
  },
];

async function sitemapUrls(base) {
  if (process.env.A11Y_URLS) {
    return process.env.A11Y_URLS.split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => new URL(p, base).toString());
  }
  const xml = await readFile(path.join(root, "dist", "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  // 404.html never appears in a sitemap but every unknown URL renders it.
  const paths = [...locs.map((loc) => new URL(loc).pathname), "/404.html"];
  return [...new Set(paths)].map((p) => new URL(p, base).toString());
}

async function startPreview() {
  if (process.env.A11Y_BASE) return { base: process.env.A11Y_BASE.replace(/\/$/, ""), stop: async () => {} };
  const child = spawn(
    process.execPath,
    [path.join(root, "scripts", "run-command.ts"), "astro", "preview", "--port", String(port)],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
  );
  const base = `http://localhost:${port}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("astro preview did not start in 60s")), 60_000);
    const check = async () => {
      try {
        const response = await fetch(base + "/");
        if (response.ok) {
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
  return {
    base,
    stop: async () => {
      child.kill();
    },
  };
}

// One page class per report row: 60 service pages fail the same way, and listing all
// 60 buries the six distinct problems.
function pageClass(pathname) {
  if (pathname === "/") return "home";
  if (pathname === "/404.html") return "404";
  if (/^\/docs\/services\/[^/]+\/[^/]+\/$/.test(pathname)) return "docs:service-subpage";
  if (/^\/docs\/services\/[^/]+\/$/.test(pathname)) return "docs:service";
  if (pathname === "/docs/services/") return "docs:services-index";
  if (pathname === "/docs/") return "docs:index";
  if (pathname.startsWith("/docs/")) return "docs:guide";
  return pathname.replace(/\//g, "") || "home";
}

async function run() {
  const { base, stop } = await startPreview();
  const browser = await chromium.launch();
  const urls = (await sitemapUrls(base)).slice(0, limit);
  const full = process.env.A11Y_FULL === "1";

  // One representative URL per page class — everything else on the site is the
  // same template with different prose, so those carry the theme × viewport sweep.
  const representative = new Map();
  for (const url of urls) {
    const cls = pageClass(new URL(url).pathname);
    if (!representative.has(cls)) representative.set(cls, url);
  }
  const deepUrls = new Set(representative.values());

  const findings = [];
  let checked = 0;

  try {
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const isBaseline = viewport.name === "desktop" && theme.name === "light-os";
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: theme.colorScheme,
          reducedMotion: "no-preference",
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        for (const url of urls) {
          // Baseline pass covers every page once; the other passes cover one page
          // per class. A11Y_FULL=1 crosses everything with everything.
          if (!full && !isBaseline && !deepUrls.has(url)) continue;
          for (const state of STATES) {
            if (state.when && !state.when(url, viewport)) continue;
            // Non-default states are one shared component, so audit them on a
            // representative page rather than on all 76.
            if (state.name === "search-open" && !["/", "/docs/", "/releases/"].includes(new URL(url).pathname)) continue;
            if (state.name === "menu-open" && !["/", "/support/"].includes(new URL(url).pathname)) continue;
            if (state.name === "docs-drawer-open" && !["/docs/sdk-cli/", "/docs/services/s3/"].includes(new URL(url).pathname)) continue;

            await page.goto(url, { waitUntil: "domcontentloaded" });
            await page.waitForLoadState("load").catch(() => {});
            if (theme.dataTheme) {
              await page.evaluate((value) => {
                document.documentElement.dataset.theme = value;
              }, theme.dataTheme);
              // Flipping the theme starts the 120ms colour transitions on every
              // .copy-button. Sampling mid-flight reports the interpolated colour and
              // fails contrast on text that is fine at both ends.
              await page.waitForTimeout(300);
            } else {
              await page.evaluate(() => {
                delete document.documentElement.dataset.theme;
              });
            }
            try {
              await state.apply(page);
            } catch (error) {
              findings.push({
                url,
                pathname: new URL(url).pathname,
                pageClass: pageClass(new URL(url).pathname),
                viewport: viewport.name,
                theme: theme.name,
                state: state.name,
                id: "state-setup-failed",
                impact: "serious",
                help: `Could not reach state: ${String(error).slice(0, 160)}`,
                helpUrl: "",
                nodes: [],
              });
              continue;
            }
            checked += 1;
            const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
            for (const violation of results.violations) {
              findings.push({
                url,
                pathname: new URL(url).pathname,
                pageClass: pageClass(new URL(url).pathname),
                viewport: viewport.name,
                theme: theme.name,
                state: state.name,
                id: violation.id,
                impact: violation.impact,
                help: violation.help,
                helpUrl: violation.helpUrl,
                nodes: violation.nodes.slice(0, 4).map((node) => ({
                  target: node.target.join(" "),
                  html: node.html.slice(0, 220),
                  summary: (node.failureSummary || "").slice(0, 400),
                })),
              });
            }
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stop();
  }

  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString();
  await writeFile(
    path.join(outDir, "a11y-results.json"),
    JSON.stringify({ generatedAt: stamp, base, urls: urls.length, runs: checked, findings }, null, 2),
  );
  await writeFile(path.join(outDir, "a11y-summary.md"), renderMarkdown({ stamp, urls, checked, findings }));

  const byRule = new Map();
  for (const finding of findings) byRule.set(finding.id, (byRule.get(finding.id) ?? 0) + 1);
  console.log(`\n${urls.length} pages · ${checked} audited states · ${findings.length} violation instances`);
  for (const [id, count] of [...byRule].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)}  ${id}`);
  console.log(`\nReport: ${outDir}`);
  process.exitCode = findings.length > 0 ? 1 : 0;
}

function renderMarkdown({ stamp, urls, checked, findings }) {
  const lines = [`# Accessibility audit`, ``, `- Generated: ${stamp}`, `- Pages: ${urls.length}`, `- Audited states: ${checked}`, `- Violation instances: ${findings.length}`, ``];

  const group = (key) => {
    const map = new Map();
    for (const finding of findings) {
      const value = finding[key];
      map.set(value, (map.get(value) ?? 0) + 1);
    }
    return [...map].sort((a, b) => b[1] - a[1]);
  };

  lines.push(`## By rule`, ``, `| rule | impact | count |`, `| --- | --- | --- |`);
  const impacts = new Map(findings.map((f) => [f.id, f.impact]));
  for (const [id, count] of group("id")) lines.push(`| ${id} | ${impacts.get(id) ?? ""} | ${count} |`);

  lines.push(``, `## By page class`, ``, `| page class | count |`, `| --- | --- |`);
  for (const [name, count] of group("pageClass")) lines.push(`| ${name} | ${count} |`);

  lines.push(``, `## By theme / viewport / state`, ``, `| dimension | value | count |`, `| --- | --- | --- |`);
  for (const key of ["theme", "viewport", "state"]) {
    for (const [name, count] of group(key)) lines.push(`| ${key} | ${name} | ${count} |`);
  }

  lines.push(``, `## Detail (first occurrence of each rule × page class)`, ``);
  const seen = new Set();
  for (const finding of findings) {
    const key = `${finding.id}::${finding.pageClass}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `### ${finding.id} — ${finding.pageClass}`,
      ``,
      `- ${finding.help} (${finding.impact})`,
      `- ${finding.pathname} · ${finding.theme} · ${finding.viewport} · state: ${finding.state}`,
      `- ${finding.helpUrl}`,
      ``,
    );
    for (const node of finding.nodes) {
      lines.push("```", `${node.target}`, `${node.html}`, `${node.summary}`, "```", ``);
    }
  }
  return lines.join("\n");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
