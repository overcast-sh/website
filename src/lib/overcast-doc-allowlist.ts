import fs from "node:fs/promises";
import path from "node:path";

// Shared between scripts/sync-overcast-content.ts (a plain Node script, no bundler —
// keep this file free of anything that isn't a relative import) and
// src/loaders/overcast-docs.ts (an Astro content loader, runs through Vite). Both need
// the exact same allowlist and existence-checking behavior; splitting this out replaces
// two copies that had already drifted once (docs/cli.md and docs/operation-manifest.md
// existed upstream but were only ever added to one of the two lists).

// Every doc outside docs/cdk/**, docs/https/**, docs/performance/**, docs/services/**,
// docs/networking/**, docs/cli/**, docs/configuration/** and docs/migration/** must be
// explicitly listed here to be published. A path can be listed before the file exists
// upstream — see warnMissingAllowlistedDocs below — so adding a page here ahead of the
// release that ships it is expected, not an error.
export const publicDocFiles = [
  "README.md",
  "docs/README.md",
  // Split out of docs/README.md's mega reference manual (config vars, debug endpoints,
  // storage & persistence, networking, startup troubleshooting) in an upcoming upstream
  // restructure — kept grouped here, right after the doc they came from. Storage and
  // networking each started as two pages (persistence.md/storage.md,
  // multi-container-networking.md/networking.md) and were later merged upstream into the
  // single docs/storage.md and docs/networking.md listed below (Overcast PR #1527) — the
  // old split names never need to appear here again.
  "docs/configuration.md",
  "docs/debug-endpoints.md",
  "docs/troubleshooting.md",
  "docs/sdk-cli.md",
  "docs/cli.md",
  "docs/cdk.md",
  "docs/networking.md",
  "docs/storage.md",
  "docs/performance.md",
  "docs/migration-from-localstack.md",
  "docs/localstack-compatibility.md",
  "docs/https.md",
  "docs/local-dev.md",
  "docs/testcontainers.md",
];

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function walk(dir: string, root = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute, root)));
    } else {
      files.push(normalizePath(path.relative(root, absolute)));
    }
  }
  return files;
}

export function shouldPublishDoc(relativePath: string): boolean {
  const docPath = normalizePath(relativePath);
  if (!docPath.endsWith(".md")) return false;
  if (docPath.startsWith("docs/dev/") || docPath.startsWith("docs/plans/")) return false;
  if (publicDocFiles.includes(docPath)) return true;
  return (
    docPath.startsWith("docs/cdk/") ||
    docPath.startsWith("docs/https/") ||
    docPath.startsWith("docs/performance/") ||
    docPath.startsWith("docs/services/") ||
    docPath.startsWith("docs/networking/") ||
    docPath.startsWith("docs/cli/") ||
    docPath.startsWith("docs/configuration/") ||
    docPath.startsWith("docs/migration/")
  );
}

// shouldPublishDoc()/walk() already tolerate an allowlisted-but-absent file just fine on
// their own: they walk what's actually on disk and filter, so a page that hasn't shipped
// upstream yet is simply not there to find — no error, but also no trace in the logs. That
// makes a genuine typo in publicDocFiles indistinguishable from "not released yet": both
// silently produce one fewer doc page. This walks the allowlist itself (the inverse
// direction) and logs a warning for every entry that isn't on disk, so both cases are
// visible in build output — "not in this release yet" is expected for a few entries at a
// time, but a warning that never clears across releases is a sign the path is wrong.
//
// Deliberately does not throw: a missing file is not this function's problem to fail the
// build over. A file that *is* present but malformed (bad frontmatter, schema mismatch) is
// a different, genuinely fatal problem — that's left to fail loudly wherever the content is
// actually parsed (gray-matter / parseData in src/loaders/overcast-docs.ts).
export async function warnMissingAllowlistedDocs(
  sourceRoot: string,
  log: (message: string) => void = console.warn,
): Promise<void> {
  for (const relativePath of publicDocFiles) {
    const absolute = path.join(sourceRoot, relativePath);
    if (!(await exists(absolute))) {
      log(`overcast-docs: "${relativePath}" is allowlisted in publicDocFiles but not in this release yet (${sourceRoot}) — skipped.`);
    }
  }
}
