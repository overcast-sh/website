import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  exists,
  shouldPublishDoc,
  walk,
  warnMissingAllowlistedDocs,
} from "../src/lib/overcast-doc-allowlist.ts";
import { SUPPORTED_SCHEMA as COMPAT_SCHEMA } from "../src/lib/compat-report.ts";

const repo = process.env.OVERCAST_REPO || "overcast-sh/overcast";
const sourceRef = process.env.OVERCAST_SOURCE_REF || process.env.OVERCAST_TRACKING_REF || "alpha";
const cwd = process.cwd();
const generatedDir = path.join(cwd, "src", "generated");
const obsoleteGeneratedDocsDir = path.join(generatedDir, "docs-html");
const obsoleteGeneratedDocsManifest = path.join(generatedDir, "docs-manifest.json");
const obsoleteGeneratedReleases = path.join(generatedDir, "releases.json");

type ServiceSupport = {
  service: string;
  docSlug: string;
  displayName: string;
  totalOps: number;
  implementedOps: number;
  coverage: number;
  coverageTier: string | null;
  operations: unknown[];
};

// Some service ids in the upstream operation-coverage data don't match their doc's
// filename 1:1 (e.g. the coverage data calls it `elbv2`, but the doc lives at
// docs/services/elb.md). Surface the actual doc slug alongside the service id so
// consumers don't have to assume `docs/services/<service>.md` always exists.
const serviceDocAliases: Record<string, string> = {
  elbv2: "elb",
};

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

async function resolveSourceRoot(): Promise<string> {
  const candidates = [
    process.env.OVERCAST_LOCAL_PATH,
    path.join(cwd, ".cache", "source", "overcast"),
    path.resolve(cwd, "..", "..", "overcast"),
  ].filter(isString);

  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "README.md"))) return path.resolve(candidate);
  }

  throw new Error(
    "Could not find Overcast source. Set OVERCAST_LOCAL_PATH, or checkout overcast-sh/overcast into .cache/source/overcast.",
  );
}

async function resolveBrandingRoot(): Promise<string | null> {
  const candidates = [
    process.env.OVERCAST_BRANDING_PATH,
    path.resolve(cwd, "..", "branding"),
  ].filter(isString);

  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "design-system", "tokens.css"))) return path.resolve(candidate);
  }

  return null;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonIfExists<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function countDocs(sourceRoot: string): Promise<number> {
  const docsRoot = path.join(sourceRoot, "docs");
  return [
    "README.md",
    ...((await exists(docsRoot)) ? (await walk(docsRoot)).map((file) => `docs/${file}`) : []),
  ].filter(shouldPublishDoc).length;
}

async function cleanupObsoleteGeneratedDocs(): Promise<void> {
  await fs.rm(obsoleteGeneratedDocsDir, { recursive: true, force: true });
  await fs.rm(obsoleteGeneratedDocsManifest, { force: true });
  await fs.rm(obsoleteGeneratedReleases, { force: true });
}

// docs/README.md's "Services" table (machine-generated between the overcast:service-index
// markers, one row per service) carries a "Coverage tier" column — Comprehensive / Core CRUD
// / Minimal / IaC-stub — that the raw operation-coverage JSON doesn't. The website's docs
// sidebar uses it to cluster the 50-item Service Reference list into a handful of labeled
// groups instead of one flat alphabetical scroll (see docs/[...slug].astro). Reading this
// table is a build-time parse of upstream *generated* content, the same category of thing
// countDocs()/shouldPublishDoc() already do — not an edit to upstream docs.
async function parseCoverageTiers(sourceRoot: string): Promise<Map<string, string>> {
  const tiers = new Map<string, string>();
  const readmePath = path.join(sourceRoot, "docs", "README.md");
  const content = await fs.readFile(readmePath, "utf8").catch(() => "");
  const start = content.indexOf("<!-- BEGIN overcast:service-index -->");
  const end = content.indexOf("<!-- END overcast:service-index -->");
  if (start === -1 || end === -1 || end <= start) return tiers;

  const tableBlock = content.slice(start, end);
  for (const line of tableBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const [displayName, , , tier] = cells;
    if (!displayName || displayName === "Service" || /^-+$/.test(displayName.replaceAll(" ", ""))) continue;
    if (tier) tiers.set(displayName, tier);
  }
  return tiers;
}

async function syncSupport(sourceRoot: string): Promise<ServiceSupport[]> {
  const supportPath = path.join(sourceRoot, "docs", "generated", "service-support.json");
  const raw = await readJsonIfExists<{
    generated_by?: string;
    total_ops?: number;
    services?: Array<{
      service: string;
      display_name: string;
      total_ops?: number;
      implemented_ops?: number;
      operations?: unknown[];
    }>;
  }>(supportPath, { total_ops: 0, services: [] });
  const coverageTiers = await parseCoverageTiers(sourceRoot);
  const services = (raw.services || []).map((service) => ({
    service: service.service,
    docSlug: serviceDocAliases[service.service] || service.service,
    displayName: service.display_name,
    totalOps: service.total_ops || 0,
    implementedOps: service.implemented_ops || 0,
    coverage: service.total_ops ? Math.round(((service.implemented_ops || 0) / service.total_ops) * 100) : 0,
    coverageTier: coverageTiers.get(service.display_name) || null,
    operations: service.operations || [],
  }));

  await writeJson(path.join(generatedDir, "service-support.json"), {
    generatedBy: raw.generated_by || null,
    totalOps: raw.total_ops || services.reduce((sum, service) => sum + service.totalOps, 0),
    implementedOps: services.reduce((sum, service) => sum + service.implementedOps, 0),
    services,
  });
  return services;
}

// The compatibility report (/compat/). Every Overcast release attaches a compat-report.json,
// written by `go run ./cmd/compat --publish-report` upstream; this copies one per release into
// src/generated/compat/<tag>.json and lists them, newest first, in index.json. Older releases
// stay browsable, and the newest two give the overview its release-over-release changes.
//
// Nothing here is allowed to fail the build: a network hiccup, a release without the asset, or
// a report in a schema this site does not know all degrade to fewer (or no) reports, and the
// pages render an empty state. A local file wins over the releases, so a report generated from
// a working copy can be previewed before any release carries one.
const COMPAT_ASSET = "compat-report.json";
// Enough history to see a trend, few enough that the build does not grow with every release.
const COMPAT_RELEASES_KEPT = 12;

type CompatIndexEntry = { tag: string; publishedAt: string | null; prerelease: boolean; source: "release" | "local" };

async function readCompatReport(filePath: string): Promise<{ version?: string; schema?: number } | null> {
  const report = await readJsonIfExists<{ version?: string; schema?: number } | null>(filePath, null);
  if (!report || report.schema !== COMPAT_SCHEMA) return null;
  return report;
}

async function fetchReleaseCompatReports(outDir: string): Promise<CompatIndexEntry[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "overcast-website-sync" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers });
  if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);
  const releases = (await response.json()) as Array<{
    tag_name: string;
    published_at: string | null;
    prerelease: boolean;
    draft?: boolean;
    assets: Array<{ name: string; url: string }>;
  }>;

  const entries: CompatIndexEntry[] = [];
  for (const release of releases) {
    if (release.draft || entries.length >= COMPAT_RELEASES_KEPT) continue;
    const asset = release.assets.find((candidate) => candidate.name === COMPAT_ASSET);
    if (!asset) continue;
    // The API URL with an octet-stream Accept, rather than browser_download_url: it takes the
    // same token, so a private fork or a rate-limited runner still gets the file.
    const download = await fetch(asset.url, { headers: { ...headers, Accept: "application/octet-stream" } });
    if (!download.ok) {
      console.warn(`compat: ${release.tag_name}: ${COMPAT_ASSET} returned HTTP ${download.status}; skipped`);
      continue;
    }
    const text = await download.text();
    const target = path.join(outDir, `${release.tag_name}.json`);
    await fs.writeFile(target, text, "utf8");
    if (!(await readCompatReport(target))) {
      console.warn(`compat: ${release.tag_name}: ${COMPAT_ASSET} is not schema ${COMPAT_SCHEMA}; skipped`);
      await fs.rm(target, { force: true });
      continue;
    }
    entries.push({ tag: release.tag_name, publishedAt: release.published_at, prerelease: release.prerelease, source: "release" });
  }
  return entries;
}

async function syncCompat(sourceRoot: string): Promise<number> {
  const outDir = path.join(generatedDir, "compat");
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  // OVERCAST_COMPAT_REPORT takes one path, or several separated by the platform's path
  // delimiter, newest first — two local reports are enough to preview the release-over-release
  // changes before two releases carry one.
  let entries: CompatIndexEntry[] = [];
  const localPaths = process.env.OVERCAST_COMPAT_REPORT
    ? process.env.OVERCAST_COMPAT_REPORT.split(path.delimiter).filter(Boolean)
    : [path.join(sourceRoot, COMPAT_ASSET)];
  for (const localPath of localPaths) {
    const local = await readCompatReport(localPath);
    if (!local?.version || entries.some((entry) => entry.tag === local.version)) continue;
    await fs.copyFile(localPath, path.join(outDir, `${local.version}.json`));
    entries.push({ tag: local.version, publishedAt: null, prerelease: false, source: "local" });
    console.log(`compat: using the local report at ${localPath} (${local.version})`);
  }
  if (process.env.OVERCAST_COMPAT_OFFLINE !== "1") {
    try {
      const released = await fetchReleaseCompatReports(outDir);
      entries = [...entries, ...released.filter((entry) => !entries.some((e) => e.tag === entry.tag))];
    } catch (error) {
      console.warn(`compat: could not list release reports (${(error as Error).message}); /compat/ shows ${entries.length ? "the local report only" : "an empty state"}`);
    }
  }

  await writeJson(path.join(outDir, "index.json"), entries);
  return entries.length;
}

// The vendored brand assets: [path inside the branding repo, path inside this repo].
//
// These stay *tracked* in git even though a script writes them. The deploy workflow never
// checks out overcast-sh/branding — untracking them would make every build depend on a
// second repo to render a logo. Instead `npm run content:check` compares them against the
// branding repo and CI fails on drift, so the tracked copies can't quietly rot.
//
// Anything under public/brand or public/fonts that is NOT listed here is site-owned and
// must survive a sync — public/brand/social-card.png (the OG image) is the current case.
// That is why nothing in here deletes a directory.
const brandAssets: Array<[string, string]> = [
  ["design-system/tokens.css", "src/styles/brand-tokens.css"],
  ["favicon/favicon.svg", "public/brand/favicon.svg"],
  ["favicon/favicon.ico", "public/brand/favicon.ico"],
  ["logo/overcast-logo-light.svg", "public/brand/overcast-logo-light.svg"],
  ["logo/overcast-logo-dark.svg", "public/brand/overcast-logo-dark.svg"],
  ["mark/mark-light.svg", "public/brand/mark-light.svg"],
  ["mark/mark-dark.svg", "public/brand/mark-dark.svg"],
  ["loading/overcast-loader.svg", "public/brand/overcast-loader.svg"],
  ["social/github-social-card.svg", "public/brand/github-social-card.svg"],
  ["fonts/JetBrainsMono-Regular.ttf", "public/fonts/JetBrainsMono-Regular.ttf"],
  ["fonts/JetBrainsMono-Bold.ttf", "public/fonts/JetBrainsMono-Bold.ttf"],
];

const textAssetExtensions = new Set([".css", ".svg"]);

// Read a branding-repo asset exactly as it should land in this repo. Text assets get their
// line endings normalised to LF: .gitattributes stores them as LF, so copying a CRLF working
// copy straight through leaves every SVG permanently "modified" in `git status` even though
// git normalises the content back to identical on checkin.
async function readBrandAsset(brandingRoot: string, source: string): Promise<Buffer> {
  const raw = await fs.readFile(path.join(brandingRoot, source));
  if (!textAssetExtensions.has(path.extname(source))) return raw;
  return Buffer.from(raw.toString("utf8").replaceAll("\r\n", "\n"), "utf8");
}

async function syncBranding(brandingRoot: string): Promise<void> {
  for (const [source, target] of brandAssets) {
    const targetPath = path.join(cwd, target);
    const next = await readBrandAsset(brandingRoot, source);
    // Skip the write when the bytes already match, so a sync leaves mtimes (and any
    // watcher hanging off them) alone on the common no-change path.
    const current = await fs.readFile(targetPath).catch(() => null);
    if (current && current.equals(next)) continue;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, next);
  }
}

// `--check`: report drift between the tracked brand assets and the branding repo without
// writing anything. Exits non-zero on drift so CI can gate on it.
async function checkBranding(brandingRoot: string | null): Promise<never> {
  if (!brandingRoot) {
    console.error(
      "content:check needs a branding checkout. Set OVERCAST_BRANDING_PATH, or check out overcast-sh/branding next to this repo.",
    );
    process.exit(1);
  }

  const drifted: string[] = [];
  for (const [source, target] of brandAssets) {
    const expected = await readBrandAsset(brandingRoot, source).catch(() => null);
    if (!expected) {
      drifted.push(`${target} — ${source} is missing from the branding checkout`);
      continue;
    }
    const actual = await fs.readFile(path.join(cwd, target)).catch(() => null);
    if (!actual) drifted.push(`${target} — missing`);
    else if (!actual.equals(expected)) drifted.push(`${target} — differs from branding/${source}`);
  }

  if (drifted.length === 0) {
    console.log(`Brand assets match ${brandingRoot} (${brandAssets.length} files).`);
    process.exit(0);
  }

  console.error("Vendored brand assets have drifted from overcast-sh/branding:\n");
  for (const line of drifted) console.error(`  - ${line}`);
  console.error("\nRun `npm run content:sync` with OVERCAST_BRANDING_PATH set and commit the result.");
  console.error("Site-only tokens belong in src/styles/site-tokens.css, which this check ignores.");
  process.exit(1);
}

async function main() {
  if (process.argv.includes("--check")) await checkBranding(await resolveBrandingRoot());

  const sourceRoot = await resolveSourceRoot();
  const brandingRoot = await resolveBrandingRoot();
  await fs.mkdir(generatedDir, { recursive: true });

  await cleanupObsoleteGeneratedDocs();
  await warnMissingAllowlistedDocs(sourceRoot);
  if (brandingRoot) await syncBranding(brandingRoot);
  const docsCount = await countDocs(sourceRoot);
  const services = await syncSupport(sourceRoot);
  const compatReports = await syncCompat(sourceRoot);

  await writeJson(path.join(generatedDir, "source-manifest.json"), {
    repo,
    sourceRef,
    sourceRoot,
    brandingRoot,
    generatedAt: new Date().toISOString(),
    docsCount,
    serviceCount: services.length,
    compatReports,
  });
}

await main();
