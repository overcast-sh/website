import type { Loader } from "astro/loaders";
import { z } from "zod4";
import { overcastRepo } from "./overcast-source";
import { rewriteLegacyOrgReferences } from "../lib/github-links";
import {
  autolinkIssueReferences,
  categoryForHeading,
  changelogCategoryLabels,
  findReleaseNotesLines,
  parseBulletUnit,
  splitHeadingBlocks,
  splitIntoUnits,
  splitLongEntryProse,
  summarizeMarkdown,
} from "../lib/changelog-parse";
import type { LineUnit } from "../lib/changelog-parse";
import type { ChangelogBulletEntry, ChangelogSection, OvercastReleaseData } from "../lib/release-schema";

// This loader turns a GitHub release body into the `releases` collection. The **source of truth
// for what the site shows is the GitHub release body** fetched from the API below — the site
// never reads the upstream CHANGELOG.md. release.yml upstream generates that body from the
// curated `## [x.y.z]` CHANGELOG section, so the two agree; the body is simply what arrives
// here, line structure and all.
//
// All text parsing lives in src/lib/changelog-parse.ts (import-free, so it can be unit-tested
// by changelog-parse.test.ts). This file is the GitHub fetch plus the markdown rendering of the
// strings that parser hands back — and it renders each of an entry's lines separately, because
// handing a bullet's summary and its indented detail lines to the renderer as one block is
// exactly what collapsed them into a single paragraph.
//
// The shape emitted here is defined by the zod schemas in src/lib/release-schema.ts — the same
// ones the `releases` collection validates against — so a field added here but not declared
// there is a type error rather than a value that silently vanishes.

// Two zod instances are in play in this file: `zod4` validates the GitHub API response and
// is the loader's own business, while the collection schemas have to be Astro's zod 3.
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

type MarkdownRenderer = (markdown: string) => Promise<{ html: string }>;

/** Renders one line of entry prose. Each line goes through separately, so the line structure the
 * fragment grammar encodes survives into the DOM. */
async function renderEntryLine(text: string, repo: string, renderMarkdown: MarkdownRenderer): Promise<string> {
  const { html } = await renderMarkdown(autolinkIssueReferences(text, repo));
  return html.trim();
}

/** Renders a raw (unparsed) unit unchanged — except a single-line bullet long enough to clamp
 * (the old `**Service** — prose` style is the common case) gets a lead/remainder split so it
 * still has a scannable first line. A multi-line raw unit is left whole: it already has its own
 * internal shape this function has no business second-guessing. */
async function renderRawUnit(unit: LineUnit, renderMarkdown: MarkdownRenderer): Promise<ChangelogBulletEntry> {
  if (unit.type === "bullet" && unit.lines.length === 1) {
    const bulletText = /^- (.*)$/.exec(unit.lines[0])?.[1] ?? "";
    const { lead, rest } = splitLongEntryProse(bulletText);
    if (rest) {
      const [{ html: leadHtml }, { html: restHtml }] = await Promise.all([renderMarkdown(`- ${lead}`), renderMarkdown(rest)]);
      return { kind: "raw", html: leadHtml.trim(), moreHtml: restHtml.trim() };
    }
  }

  const { html } = await renderMarkdown(unit.lines.join("\n"));
  return { kind: "raw", html: html.trim(), moreHtml: null };
}

async function parseCategoryEntries(
  units: LineUnit[],
  repo: string,
  renderMarkdown: MarkdownRenderer,
): Promise<ChangelogBulletEntry[]> {
  const entries: ChangelogBulletEntry[] = [];

  for (const unit of units) {
    const parsed = parseBulletUnit(unit);
    if (!parsed) {
      entries.push(await renderRawUnit(unit, renderMarkdown));
      continue;
    }

    // An entry can still arrive as one long summary with no detail lines (a fragment written
    // before the summary convention landed upstream). Splitting it gives that entry the same
    // scannable-first-line shape everything else has.
    const { lead, rest } =
      parsed.details.length === 0 ? splitLongEntryProse(parsed.summary) : { lead: parsed.summary, rest: null };
    const detailLines = rest ? [rest] : parsed.details;

    entries.push({
      kind: "entry",
      breaking: parsed.breaking,
      areas: parsed.areas,
      summaryHtml: await renderEntryLine(lead, repo, renderMarkdown),
      detailsHtml: await Promise.all(detailLines.map((line) => renderEntryLine(line, repo, renderMarkdown))),
      migrationHtml: parsed.migration ? await renderEntryLine(parsed.migration, repo, renderMarkdown) : null,
    });
  }

  return entries;
}

/**
 * Parses a release body's "## Release Notes" section into category sections with decorated
 * entries. Returns an empty array when the body has no such heading at all (pre-Docker-image
 * era releases) — the caller falls back to rendering the whole body as plain markdown. Within a
 * recognized category each bullet is parsed independently: one that doesn't match the fragment
 * grammar renders through the normal markdown pipeline unchanged, right alongside its decorated
 * siblings (this happens on releases straddling the v0.0.1-alpha.27 format change, and wholesale
 * for every release before it).
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
    const category = block.headingText ? categoryForHeading(block.headingText) : undefined;

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
    // The explicit return type is what makes the schema binding load-bearing: it puts the
    // object literal below under excess-property checking, so a field this loader starts
    // emitting has to be declared in the schema before it will compile.
    data.slice(0, 30).map(async (release): Promise<OvercastReleaseData> => {
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
