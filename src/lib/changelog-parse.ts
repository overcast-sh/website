// Pure text parsing for a release body's "## Release Notes" section.
//
// This module has **no runtime imports** — not Astro, not zod, not the markdown renderer — so
// it can be unit-tested with `node --test` (see changelog-parse.test.ts) without booting a
// build. src/loaders/overcast-releases.ts is the only caller: it feeds the release body in and
// renders the strings this returns.
//
// -- The fragment grammar this parses ---------------------------------------
//
// Release notes are assembled upstream by `scripts/changelog.py assemble` (see
// `.changelog/README.md` in overcast-sh/overcast), which emits:
//
//   ### Added | Changed | Deprecated | Removed | Fixed | Security
//
//   - [area[/area...]] summary sentence, capped at 160 chars
//     a detail line, one per line
//     another detail line
//   - **BREAKING** [area] summary sentence
//     detail line
//     migration: what a user has to do
//
// The **line structure is load-bearing**: the first line is a standalone summary and each
// indented continuation line is its own thought. Handing the block to a markdown renderer
// merges all of them into one paragraph, which is exactly the wall of text this parser exists
// to avoid — so continuation lines are split out here and rendered individually.
//
// Older releases (roughly v0.0.1-alpha.27 and earlier) predate the fragment system and write
// entries as `**Service Name** — prose`, with no `[area]` bracket and no BREAKING/migration
// convention. Parsing is deliberately per-bullet: a bullet that doesn't match returns null and
// the caller renders its raw markdown unchanged.

/** Changelog categories, in the order `scripts/changelog.py assemble` emits them upstream.
 * Declared here rather than in release-schema.ts so this module stays import-free; the schema
 * imports it back. */
export const changelogCategories = ["added", "changed", "deprecated", "removed", "fixed", "security"] as const;

export type ChangelogCategoryName = (typeof changelogCategories)[number];

export const changelogCategoryLabels: Record<ChangelogCategoryName, string> = {
  added: "Added",
  changed: "Changed",
  deprecated: "Deprecated",
  removed: "Removed",
  fixed: "Fixed",
  security: "Security",
};

export const summaryCharacterLimit = 360;
export const longEntryCharacterThreshold = 160;
const minimumClampedRemainderLength = 20;
const boilerplateHeadings = new Set(["docker images", "native binaries"]);

/** Splits text on inline code spans, so a transform can be applied to prose only. Odd indexes
 * are the code spans, backticks included. */
function splitOnCodeSpans(text: string): string[] {
  return text.split(/(`[^`]*`)/g);
}

/**
 * Flattens markdown to plain text for contexts that can't render HTML (a `<meta>` description,
 * a search index).
 *
 * Emphasis markers are stripped **outside code spans only**. Doing it globally is what turned
 * `LAMBDA_RUNTIME_API_HOST` into `LAMBDARUNTIMEAPIHOST` and `/_overcast/debug/reset` into
 * `/overcast/debug/reset` on the downloads card: release notes name env vars and paths inside
 * backticks constantly, and underscores are the one thing they always contain.
 */
export function cleanInlineMarkdown(markdown: string): string {
  return splitOnCodeSpans(markdown)
    .map((segment, index) =>
      index % 2 === 1
        ? segment.slice(1, -1)
        : segment.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_~]/g, ""),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateAtSentence(text: string, limit: number = summaryCharacterLimit): string {
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

/** Plain-text nodes for the release-level `summary` field (the `<meta>` description fallback
 * for a release whose body the structured parser can't read at all). */
export function extractSummaryNodes(markdown: string): string[] {
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

export function summarizeMarkdown(markdown: string): string {
  return truncateAtSentence(extractSummaryNodes(markdown).slice(0, 3).join(" "));
}

/** Matches a `### Heading` against the known categories, so adding one to the list above is all
 * it takes for its heading to be recognized. */
export function categoryForHeading(headingText: string): ChangelogCategoryName | undefined {
  const normalized = headingText.replace(/:$/, "").toLowerCase();
  return changelogCategories.find((category) => category === normalized);
}

/** A single "### Heading" block's raw lines, keyed by its (recognized-or-not) heading text. */
export type HeadingBlock = { headingText: string | null; content: string[] };

/** One bullet's own lines (the `- ` line plus any indented continuation), or a run of
 * non-bullet lines (stray prose between/after bullets, e.g. a trailing `Release: <url>` line). */
export type LineUnit = { type: "bullet" | "raw"; lines: string[] };

/**
 * Finds the lines belonging to the "## Release Notes" (any heading level) section, bounded by
 * the next heading of equal-or-higher level. Returns null when the body has no such heading at
 * all — callers fall back to rendering the whole body as plain markdown.
 */
export function findReleaseNotesLines(bodyLines: string[]): string[] | null {
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
export function splitHeadingBlocks(lines: string[]): HeadingBlock[] {
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

/** Groups a heading block's content lines into ordered units: a top-level `- ` bullet (with its
 * indented continuation lines attached), or a run of stray non-bullet lines. A blank line always
 * ends the current unit. */
export function splitIntoUnits(lines: string[]): LineUnit[] {
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

export type ParsedBullet = {
  breaking: boolean;
  areas: string[];
  /** The bullet's first line: a standalone summary sentence. */
  summary: string;
  /** Each indented continuation line, in order, one entry per source line. Never merged. */
  details: string[];
  migration: string | null;
};

/**
 * Matches the fragment grammar: `- [**BREAKING** ]?[area[/area...]] summary`, followed by any
 * number of indented continuation lines, of which one may be `migration: ...`.
 *
 * Returns null for anything else — the pre-2026 `**Service** — prose` style, a bullet with no
 * area bracket, an empty migration — so the caller renders that bullet's raw markdown unchanged.
 *
 * Note what this does **not** do any more: cap the number of continuation lines. Bailing at more
 * than one was what sent every richly-detailed alpha.39 entry (and both of its multi-line
 * BREAKING entries, migration notes and all) down the raw path to be flattened into a single
 * paragraph.
 */
export function parseBulletUnit(unit: LineUnit): ParsedBullet | null {
  if (unit.type !== "bullet" || unit.lines.length === 0) return null;

  const match = /^- (\*\*BREAKING\*\* )?\[([^\]]+)\]\s*(.*)$/.exec(unit.lines[0]);
  if (!match) return null;

  const summary = match[3].trim();
  if (!summary) return null;

  const areas = match[2]
    .split("/")
    .map((area) => area.trim())
    .filter(Boolean);
  if (areas.length === 0) return null;

  const details: string[] = [];
  let migration: string | null = null;

  for (const rawLine of unit.lines.slice(1)) {
    const line = rawLine.trim();
    if (!line) continue;

    const migrationMatch = /^migration:\s*(.*)$/i.exec(line);
    if (migrationMatch) {
      // A second `migration:` line would silently overwrite the first, so treat the whole
      // bullet as unrecognized rather than dropping a user's upgrade instructions.
      if (migration !== null) return null;
      if (!migrationMatch[1].trim()) return null;
      migration = migrationMatch[1].trim();
      continue;
    }

    details.push(line);
  }

  return { breaking: Boolean(match[1]), areas, summary, details, migration };
}

/**
 * Splits one long line of prose into a lead sentence and a remainder, so a legacy entry written
 * as a single paragraph still gets a scannable first line. Only clamps when the text is past the
 * length threshold AND has more than one sentence boundary to split on — a single very long
 * sentence has nothing sensible to hide, so it stays whole. The boundary search skips inline code
 * spans so a split can never land mid-`code`, which would unbalance the backticks once each half
 * is rendered independently.
 *
 * Entries written to the current fragment grammar never reach this: their summary is already a
 * standalone first line and their detail lines arrive pre-split.
 */
export function splitLongEntryProse(text: string): { lead: string; rest: string | null } {
  if (text.length <= longEntryCharacterThreshold) return { lead: text, rest: null };

  const segments = splitOnCodeSpans(text);
  const boundaryPositions: number[] = [];
  let offset = 0;
  for (const [index, segment] of segments.entries()) {
    if (index % 2 === 0) {
      for (const match of segment.matchAll(/[.;:](?=\s)/g)) {
        boundaryPositions.push(offset + (match.index ?? 0) + 1);
      }
    }
    offset += segment.length;
  }
  if (boundaryPositions.length < 2) return { lead: text, rest: null };

  const splitAt = boundaryPositions[0];
  const lead = text.slice(0, splitAt).trim();
  const rest = text.slice(splitAt).trim();
  if (rest.length < minimumClampedRemainderLength) return { lead: text, rest: null };

  return { lead, rest };
}

/** Turns a bare `#1234` issue/PR reference into a markdown link, skipping anything inside inline
 * code spans so a shell flag or hex-ish token is never mistaken for one. */
export function autolinkIssueReferences(text: string, repo: string): string {
  return splitOnCodeSpans(text)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(
        /(^|[^\w`#])#(\d{2,6})\b/g,
        (_match, before: string, issueNumber: string) => `${before}[#${issueNumber}](https://github.com/${repo}/issues/${issueNumber})`,
      );
    })
    .join("");
}
