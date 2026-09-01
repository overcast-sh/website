import type { Loader } from "astro/loaders";
import { z } from "zod4";
import { overcastRepo } from "./overcast-source";
import { rewriteLegacyOrgReferences } from "../lib/github-links";

// -- Changelog structure -----------------------------------------------------
//
// Recent overcast releases (see .changelog/README.md upstream) assemble their
// "## Release Notes" body from `scripts/changelog.py assemble`, which emits a
// very regular shape:
//
//   ### Added | Changed | Deprecated | Removed | Fixed | Security
//
//   - [area[/area...]] prose text
//   - **BREAKING** [area] prose text
//     migration: what a user has to do
//
// Older releases (roughly v0.0.1-alpha.27 and earlier) predate that fragment
// system and write entries as `**Service Name** — prose` instead, with no
// `[area]` bracket and no BREAKING/migration convention at all. Parsing below
// is deliberately per-entry: a category heading is recognized independently
// of whether its bullets match the bracket grammar, and a bullet that doesn't
// match renders through the exact same markdown pipeline as today, unchanged.

export type ChangelogCategory = "added" | "changed" | "deprecated" | "removed" | "fixed" | "security";

export type ChangelogBulletEntry =
  | {
      kind: "entry";
      breaking: boolean;
      areas: string[];
      proseHtml: string;
      proseText: string;
      migrationHtml: string | null;
    }
  | { kind: "raw"; html: string };

export type ChangelogSection =
  | { kind: "category"; category: ChangelogCategory; label: string; entries: ChangelogBulletEntry[] }
  | { kind: "raw"; html: string };

export type OvercastReleaseData = {
  tagName: string;
  name: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
  body: string;
  summary: string;
  changelogSections: ChangelogSection[];
  assets: Array<{
    name: string;
    size: number;
    downloadUrl: string;
  }>;
};

const githubReleaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  html_url: z.url(),
  published_at: z.string().nullable(),
  prerelease: z.boolean(),
  body: z.string().nullable(),
  assets: z.array(
    z.object({
      name: z.string(),
      size: z.number(),
      browser_download_url: z.url(),
    }),
  ),
});

const githubReleasesSchema = z.array(githubReleaseSchema);

const summaryCharacterLimit = 360;
const entryPreviewCharacterLimit = 170;
const boilerplateHeadings = new Set(["docker images", "native binaries"]);

function cleanInlineMarkdown(markdown: string): string {
  return markdown
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtSentence(text: string, limit: number = summaryCharacterLimit): string {
  if (text.length <= limit) return text;

  const sliced = text.slice(0, limit).trim();
  const sentenceEnd = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf("; "), sliced.lastIndexOf(": "));
  if (sentenceEnd > limit * 0.55) return `${sliced.slice(0, sentenceEnd + 1).trim()}...`;

  const wordEnd = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, wordEnd > 0 ? wordEnd : limit).trim()}...`;
}

function releaseNotesSection(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const releaseNotesStart = lines.findIndex((line) => /^#{1,6}\s+release notes\s*$/i.test(line.trim()));
  return releaseNotesStart >= 0 ? lines.slice(releaseNotesStart + 1) : lines;
}

function extractSummaryNodes(markdown: string): string[] {
  const nodes: string[] = [];
  const paragraph: string[] = [];
  let currentHeading = "";
  let inFence = false;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const text = cleanInlineMarkdown(paragraph.join(" "));
    paragraph.length = 0;
    if (text) nodes.push(text);
  }

  for (const rawLine of releaseNotesSection(markdown)) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      inFence = !inFence;
      flushParagraph();
      continue;
    }
    if (inFence) continue;

    if (!line) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      currentHeading = cleanInlineMarkdown(heading[1]).replace(/:$/, "");
      continue;
    }

    if (boilerplateHeadings.has(currentHeading.toLowerCase())) continue;
    if (/^\|.*\|$/.test(line) || /^[-:\s|]+$/.test(line)) continue;
    if (/^(pull|channel tag|registry|download a binary|asset|sha256|docker run)\b/i.test(line)) continue;

    const listItem = line.match(/^[-*+]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      const text = cleanInlineMarkdown(listItem[1]);
      if (text) nodes.push(currentHeading ? `${currentHeading}: ${text}` : text);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return nodes;
}

function summarizeMarkdown(markdown: string): string {
  const nodes = extractSummaryNodes(markdown);
  return truncateAtSentence(nodes.slice(0, 3).join(" "));
}

// -- Changelog parsing --------------------------------------------------------

type MarkdownRenderer = (markdown: string) => Promise<{ html: string }>;

const changelogCategoriesByHeading: Record<string, ChangelogCategory> = {
  added: "added",
  changed: "changed",
  deprecated: "deprecated",
  removed: "removed",
  fixed: "fixed",
  security: "security",
};

const changelogCategoryLabels: Record<ChangelogCategory, string> = {
  added: "Added",
  changed: "Changed",
  deprecated: "Deprecated",
  removed: "Removed",
  fixed: "Fixed",
  security: "Security",
};

/** A single "### Category" block's raw lines, keyed by its (unrecognized-or-not) heading text. */
type HeadingBlock = { headingText: string | null; content: string[] };

/** One bullet's own lines (the `- ...` line plus any indented continuation), or a run of
 * non-bullet lines (stray prose between/after bullets, e.g. the trailing `Release: <url>` line). */
type LineUnit = { type: "bullet" | "raw"; lines: string[] };

/**
 * Finds the lines that belong to the "## Release Notes" (or any heading level) section,
 * bounded by the next heading of equal-or-higher level. Returns null when the body has no
 * such heading at all — callers fall back to rendering the whole body exactly as today.
 */
function findReleaseNotesLines(bodyLines: string[]): string[] | null {
  const headingIndex = bodyLines.findIndex((line) => /^#{1,6}\s+release notes\s*$/i.test(line.trim()));
  if (headingIndex < 0) return null;

  const headingLevel = (bodyLines[headingIndex].match(/^#+/) ?? ["##"])[0].length;
  const rest = bodyLines.slice(headingIndex + 1);
  const endIndex = rest.findIndex((line) => {
    const heading = /^(#{1,6})\s+/.exec(line);
    return heading ? heading[1].length <= headingLevel : false;
  });
  return endIndex >= 0 ? rest.slice(0, endIndex) : rest;
}

/** Splits release-notes lines into blocks at each `### Heading` boundary. Content before the
 * first heading (rare) is kept as a block with `headingText: null`. */
function splitHeadingBlocks(lines: string[]): HeadingBlock[] {
  const blocks: HeadingBlock[] = [];
  let current: HeadingBlock = { headingText: null, content: [] };

  for (const line of lines) {
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(current);
      current = { headingText: heading[1].trim(), content: [] };
    } else {
      current.content.push(line);
    }
  }
  blocks.push(current);

  return blocks.filter((block) => block.headingText !== null || block.content.some((line) => line.trim() !== ""));
}

/** Groups a heading block's content lines into ordered units: a top-level `- ` bullet (with
 * its indented continuation lines attached), or a run of stray non-bullet lines. A blank line
 * always ends the current unit. */
function splitIntoUnits(lines: string[]): LineUnit[] {
  const units: LineUnit[] = [];
  let current: LineUnit | null = null;

  const flush = () => {
    if (current) units.push(current);
    current = null;
  };

  for (const line of lines) {
    if (/^- /.test(line)) {
      flush();
      current = { type: "bullet", lines: [line] };
    } else if (line.trim() === "") {
      flush();
    } else if (current?.type === "bullet" && /^\s+\S/.test(line)) {
      current.lines.push(line);
    } else if (current?.type === "raw") {
      current.lines.push(line);
    } else {
      flush();
      current = { type: "raw", lines: [line] };
    }
  }
  flush();

  return units;
}

type ParsedBullet = { breaking: boolean; areas: string[]; prose: string; migration: string | null };

/**
 * Matches the release-prep fragment grammar: `- [!]? [area[/area...]] prose`, optionally
 * followed by exactly one `  migration: ...` continuation line. Anything else — the pre-2026
 * `**Service** — prose` style, a bullet with no area, multiple continuation lines, an empty
 * migration — returns null so the caller renders the bullet's own raw markdown unchanged.
 */
function parseBulletUnit(unit: LineUnit): ParsedBullet | null {
  const match = /^- (\*\*BREAKING\*\* )?\[([^\]]+)\]\s*(.*)$/.exec(unit.lines[0]);
  if (!match) return null;

  const prose = match[3].trim();
  if (!prose) return null;

  const areas = match[2]
    .split("/")
    .map((area) => area.trim())
    .filter(Boolean);
  if (areas.length === 0) return null;

  if (unit.lines.length > 2) return null;

  let migration: string | null = null;
  if (unit.lines.length === 2) {
    const migrationMatch = /^ {2}migration:\s*(.*)$/i.exec(unit.lines[1]);
    if (!migrationMatch || !migrationMatch[1].trim()) return null;
    migration = migrationMatch[1].trim();
  }

  return { breaking: Boolean(match[1]), areas, prose, migration };
}

/** Turns a bare `#1234` issue/PR reference into a markdown link, skipping anything inside
 * inline code spans so a shell flag or hex-ish token is never mistaken for one. */
function autolinkIssueReferences(text: string, repo: string): string {
  return text
    .split(/(`[^`]*`)/g)
    .map((segment, index) => {
      if (index % 2 === 1) return segment; // inline code span, left untouched
      return segment.replace(
        /(^|[^\w`#])#(\d{2,6})\b/g,
        (_match, before: string, issueNumber: string) => `${before}[#${issueNumber}](https://github.com/${repo}/issues/${issueNumber})`,
      );
    })
    .join("");
}

async function renderEntryProse(text: string, repo: string, renderMarkdown: MarkdownRenderer): Promise<string> {
  const { html } = await renderMarkdown(autolinkIssueReferences(text, repo));
  return html.trim();
}

async function renderRawUnit(unit: LineUnit, renderMarkdown: MarkdownRenderer): Promise<ChangelogBulletEntry> {
  const { html } = await renderMarkdown(unit.lines.join("\n"));
  return { kind: "raw", html: html.trim() };
}

async function parseCategoryEntries(
  units: LineUnit[],
  repo: string,
  renderMarkdown: MarkdownRenderer,
): Promise<ChangelogBulletEntry[]> {
  const entries: ChangelogBulletEntry[] = [];

  for (const unit of units) {
    if (unit.type !== "bullet") {
      entries.push(await renderRawUnit(unit, renderMarkdown));
      continue;
    }

    const parsed = parseBulletUnit(unit);
    if (!parsed) {
      entries.push(await renderRawUnit(unit, renderMarkdown));
      continue;
    }

    entries.push({
      kind: "entry",
      breaking: parsed.breaking,
      areas: parsed.areas,
      proseHtml: await renderEntryProse(parsed.prose, repo, renderMarkdown),
      proseText: truncateAtSentence(cleanInlineMarkdown(parsed.prose), entryPreviewCharacterLimit),
      migrationHtml: parsed.migration ? await renderEntryProse(parsed.migration, repo, renderMarkdown) : null,
    });
  }

  return entries;
}

/**
 * Parses a release body's "## Release Notes" section into category sections with decorated
 * entries. Returns an empty array when the body has no such heading at all (pre-Docker-image
 * era releases) — the caller falls back to rendering the whole body exactly as today. Within
 * a recognized category, each bullet is parsed independently: one that doesn't match the
 * fragment grammar renders through the normal markdown pipeline unchanged, right alongside its
 * decorated siblings (this happens for real on releases straddling the v0.0.1-alpha.27 format
 * change, and wholesale for every release before it).
 */
async function parseChangelogSections(
  body: string,
  repo: string,
  renderMarkdown: MarkdownRenderer,
): Promise<ChangelogSection[]> {
  const releaseNotesLines = findReleaseNotesLines(body.replace(/\r\n/g, "\n").split("\n"));
  if (!releaseNotesLines) return [];

  const sections: ChangelogSection[] = [];

  for (const block of splitHeadingBlocks(releaseNotesLines)) {
    const category = block.headingText ? changelogCategoriesByHeading[block.headingText.replace(/:$/, "").toLowerCase()] : undefined;

    if (!category) {
      const markdownSlice = [block.headingText ? `### ${block.headingText}` : null, ...block.content]
        .filter((line): line is string => line !== null)
        .join("\n")
        .trim();
      if (!markdownSlice) continue;
      const { html } = await renderMarkdown(markdownSlice);
      sections.push({ kind: "raw", html: html.trim() });
      continue;
    }

    sections.push({
      kind: "category",
      category,
      label: changelogCategoryLabels[category],
      entries: await parseCategoryEntries(splitIntoUnits(block.content), repo, renderMarkdown),
    });
  }

  return sections;
}

async function fetchGitHubReleases(renderMarkdown: MarkdownRenderer): Promise<OvercastReleaseData[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${overcastRepo}/releases`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (process.env.CI) throw error;
    return [];
  }

  if (!response.ok) {
    const message = `GitHub releases request failed with ${response.status} ${response.statusText}`;
    if (process.env.CI) throw new Error(message);
    return [];
  }

  const data = githubReleasesSchema.parse(await response.json());
  return Promise.all(
    data.slice(0, 30).map(async (release) => {
      // Old release bodies reference the pre-rename `Neaox` GitHub org / `ghcr.io/neaox`
      // image namespace. Those releases will never be edited upstream, so rewrite the
      // stale org references before summarizing/rendering, so both the raw body and the
      // rendered markdown are clean.
      const body = rewriteLegacyOrgReferences(release.body || "");
      return {
        tagName: release.tag_name,
        name: release.name || release.tag_name,
        url: release.html_url,
        publishedAt: release.published_at,
        prerelease: release.prerelease,
        body,
        summary: summarizeMarkdown(body),
        changelogSections: await parseChangelogSections(body, overcastRepo, renderMarkdown),
        assets: (release.assets || []).map((asset) => ({
          name: asset.name,
          size: asset.size,
          downloadUrl: asset.browser_download_url,
        })),
      };
    }),
  );
}

export function overcastReleasesLoader(): Loader {
  return {
    name: "overcast-releases",
    async load({ store, parseData, renderMarkdown, generateDigest }) {
      const releases = await fetchGitHubReleases(renderMarkdown);

      store.clear();
      for (const release of releases) {
        const data = await parseData({
          id: release.tagName,
          data: release satisfies OvercastReleaseData,
        });
        store.set({
          id: release.tagName,
          data,
          rendered: await renderMarkdown(release.body),
          digest: generateDigest(JSON.stringify(release)),
        });
      }
    },
  };
}
