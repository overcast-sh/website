import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { Loader } from "astro/loaders";
import { exists, resolveOvercastSourceRoot } from "./overcast-source";
import { overcastEditRef, overcastGitHubRepo, rewriteLegacyOrgReferences } from "../lib/github-links";
import { normalizePath, shouldPublishDoc, walk, warnMissingAllowlistedDocs } from "../lib/overcast-doc-allowlist";

export type OvercastDocData = {
  sourcePath: string;
  slug: string;
  title: string;
  description: string;
  section: string;
  searchText: string;
};

function titleFromPath(docPath: string): string {
  const name = docPath.split("/").pop()?.replace(/\.md$/, "") || "Documentation";
  if (name.toLowerCase() === "readme") return docPath === "README.md" ? "Overview" : "Documentation";
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function sectionFor(docPath: string, frontmatter: Record<string, unknown>): string {
  // docs/README.md is the full config/debug/storage/networking/troubleshooting reference — it's
  // relocated off the L1 landing page (see slugFor) to its own L3 reference page, and
  // grouped in the sidebar accordingly rather than under its own frontmatter section
  // ("Getting Started", inherited from when it doubled as the index).
  if (docPath === "docs/README.md") return "Reference";
  if (frontmatter.section) return String(frontmatter.section);
  if (docPath === "README.md") return "Overview";
  // Every individual docs/services/*.md file sets its own frontmatter section to
  // "Service Reference" already (caught by the check above); this fallback only ever
  // fires for docs/services/README.md, which doesn't. Match the same label so the
  // sidebar shows one "Service Reference" group instead of two near-duplicate headings.
  if (docPath.startsWith("docs/services/")) return "Service Reference";
  if (docPath.startsWith("docs/cdk")) return "CDK";
  return "Guides";
}

// docs/README.md is the full ~650-line reference manual (config vars, debug endpoints,
// storage & persistence, networking, troubleshooting) — historically it also
// rendered at `/docs/`, making the docs landing page the reference manual instead of an
// orientation page. It now lives at its own stable URL, `/docs/reference/`, so `/docs/`
// is free for a hand-authored L1 index (src/pages/docs/index.astro) and every existing
// internal anchor (`#configuration-reference`, `#persistence`, etc.) and cross-file link
// into this document keeps resolving, unmodified, at the new location — rewriteMarkdownLinks
// below re-targets every such link automatically since it also calls slugFor().
function slugFor(docPath: string): string {
  if (docPath === "README.md") return "docs/overview";
  if (docPath === "docs/README.md") return "docs/reference";
  if (docPath === "docs/cdk/README.md") return "docs/cdk/overview";
  return docPath.replace(/^docs\//, "docs/").replace(/README\.md$/, "").replace(/\.md$/, "");
}

function githubSourceUrl(kind: "blob" | "tree", relativePath: string, hash: string): string {
  const encoded = relativePath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const base = `https://github.com/${overcastGitHubRepo}/${kind}/${overcastEditRef}/${encoded}`;
  return kind === "tree" ? base : `${base}${hash}`;
}

// Resolve a markdown link target against the directory of the doc it appears in (mirroring
// how a browser/editor would resolve it), instead of always treating it as relative to the
// docs root. `docPath.md` links from within `docs/services/*.md` or `docs/cdk/*.md`, and
// `../`-style links that walk back up to the repo root, both depend on this.
function resolveDocLinkTarget(sourcePath: string, rawTarget: string): string {
  const sourceDir = path.posix.dirname(normalizePath(sourcePath));
  const target = normalizePath(rawTarget);
  const joined = sourceDir === "." ? target : `${sourceDir}/${target}`;
  return path.posix.normalize(joined).replace(/\/$/, "");
}

function rewriteMarkdownLinks(markdown: string, sourcePath: string): string {
  return markdown.replace(/\]\((?!https?:|mailto:)([^)#]+)(#[^)]*)?\)/g, (whole, rawTarget: string, rawHash?: string) => {
    const hash = rawHash || "";
    const isDirLink = rawTarget.endsWith("/");
    const resolved = resolveDocLinkTarget(sourcePath, rawTarget);

    // A link that walks above the repo root isn't one we can resolve (shouldn't happen for
    // valid docs) — leave it untouched rather than emitting something nonsensical.
    if (resolved === ".." || resolved.startsWith("../")) return whole;

    // Directory-style links (e.g. `./docs/services/`, `./cdk/`) point at that directory's
    // README, same as GitHub's own folder browsing does.
    const docCandidate = isDirLink ? `${resolved}/README.md` : resolved;
    if (docCandidate.endsWith(".md") && shouldPublishDoc(docCandidate)) {
      const slug = slugFor(docCandidate).replace(/\/$/, "");
      return `](/${slug}/${hash})`;
    }

    // The target isn't a doc the site publishes — either it's a repo file the site never
    // renders (LICENSE, CONTRIBUTING.md, AGENTS.md, STATUS.md, source files, ...) or it's
    // inside an area the sync deliberately excludes (docs/dev/**, docs/plans/**). Rather than
    // emit a link into the void, send readers to the file/folder on GitHub.
    const basename = resolved.split("/").pop() || "";
    if (!isDirLink && basename === "LICENSE") {
      return `](${githubSourceUrl("blob", resolved, hash)})`;
    }
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(basename);
    if (isDirLink || !hasExtension) {
      return `](${githubSourceUrl("tree", resolved, "")})`;
    }
    return `](${githubSourceUrl("blob", resolved, hash)})`;
  });
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let backtickRun = 0;
  let escaped = false;

  for (const character of trimmed) {
    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      cell += character;
      escaped = true;
      continue;
    }

    if (character === "`") {
      backtickRun = backtickRun === 0 ? 1 : 0;
      cell += character;
      continue;
    }

    if (character === "|" && backtickRun === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());
  return cells;
}

function tableRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function tableDelimiter(columnCount: number): string {
  return tableRow(Array.from({ length: columnCount }, () => "---"));
}

function normalizeTableBlock(block: readonly string[]): string[] {
  if (block.length < 2) return [...block];

  const columnCount = tableCells(block[0]).length;
  if (columnCount === 0) return [...block];

  const rows = [block[0], tableDelimiter(columnCount)];

  for (const line of block.slice(2)) {
    const cells = tableCells(line);
    if (cells.length <= columnCount) {
      rows.push(tableRow([...cells, ...Array.from({ length: columnCount - cells.length }, () => "")]));
      continue;
    }

    if (columnCount === 2) {
      const firstRow = cells.slice(0, 2);
      const remaining = cells.slice(2).filter((cell) => cell.length > 0);
      rows.push(tableRow(firstRow));
      for (let index = 0; index < remaining.length; index += 2) {
        rows.push(tableRow([remaining[index] ?? "", remaining[index + 1] ?? ""]));
      }
      continue;
    }

    rows.push(tableRow(cells.slice(0, columnCount)));
  }

  return rows;
}

function normalizeMarkdownTables(markdown: string): string {
  const normalized: string[] = [];
  const tableBlock: string[] = [];

  function flushTable() {
    if (tableBlock.length === 0) return;
    normalized.push(...normalizeTableBlock(tableBlock));
    tableBlock.length = 0;
  }

  for (const line of markdown.split("\n")) {
    if (isTableLine(line)) {
      tableBlock.push(line);
      continue;
    }

    flushTable();
    normalized.push(line);
  }

  flushTable();
  return normalized.join("\n");
}

export function overcastDocsLoader(): Loader {
  return {
    name: "overcast-docs",
    async load({ store, parseData, renderMarkdown, generateDigest, logger }) {
      const sourceRoot = await resolveOvercastSourceRoot();
      const docsRoot = path.join(sourceRoot, "docs");
      await warnMissingAllowlistedDocs(sourceRoot, (message) => logger.warn(message));
      const docPaths = [
        "README.md",
        ...((await exists(docsRoot)) ? (await walk(docsRoot)).map((file) => `docs/${file}`) : []),
      ]
        .filter(shouldPublishDoc)
        .sort();

      store.clear();

      for (const sourcePath of docPaths) {
        const absolute = path.join(sourceRoot, sourcePath);
        const raw = await fs.readFile(absolute, "utf8");
        const parsed = matter(raw);
        // docs/README.md's own frontmatter title/description ("Documentation" / "This
        // directory contains the full Overcast documentation...") were written for when
        // this file doubled as the site's docs index. Now that it's the L3 reference page
        // (see slugFor/sectionFor above), override both so the page chrome describes what's
        // actually on the page instead of pointing back at itself.
        const title =
          sourcePath === "docs/README.md" ? "Full reference" : String(parsed.data.title || titleFromPath(sourcePath));
        const description =
          sourcePath === "docs/README.md"
            ? "Configuration variables, debug endpoints, storage & persistence, networking, and startup troubleshooting — everything in one scannable page."
            : String(parsed.data.description || "");
        const slug = slugFor(sourcePath).replace(/\/$/, "");
        const body = normalizeMarkdownTables(rewriteMarkdownLinks(rewriteLegacyOrgReferences(parsed.content), sourcePath));
        const data = await parseData({
          id: slug,
          data: {
            sourcePath,
            slug,
            title,
            description,
            section: sectionFor(sourcePath, parsed.data),
            searchText: `${title} ${description} ${body}`.toLowerCase(),
          } satisfies OvercastDocData,
        });

        store.set({
          id: slug,
          data,
          rendered: await renderMarkdown(body),
          digest: generateDigest(`${sourcePath}\n${raw}`),
        });
      }
    },
  };
}
