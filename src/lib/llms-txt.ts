/**
 * Builds /llms.txt — the llmstxt.org index — and the link rewriting its companion raw
 * markdown endpoints need.
 *
 * Two published routes make the docs readable without a browser:
 *
 * - `/<slug>.md` (src/pages/[...slug].md.ts) serves a doc's markdown, the same body the
 *   HTML page renders from.
 * - `/llms.txt` (src/pages/llms.txt.ts) is the index into those: an entry per page, with
 *   the title and description the collection already carries.
 *
 * Nothing here reads the filesystem or `astro:content`, so `npm test` can exercise it
 * under Node's test runner without a build — same reason service-docs.ts is shaped that
 * way, and this module imports that one for the slug parsing it already does.
 *
 * On the split between the main sections and `## Optional`: the spec's Optional section
 * means "skip this if you need a shorter context". The docs collection is ~190 pages, and
 * ~120 of them are a sub-page of a service or a guide (docs/services/s3/operations,
 * docs/networking/hostnames). Those are what you fetch once you know which service or
 * guide you are in, so they go under Optional and the ~70 landing pages stay above it.
 */
import { guideLabel, parseGuideDocSlug, parseServiceDocSlug } from "./service-docs.ts";
import { SITE_PAGES, type SitePage } from "./site-pages.ts";

/** A docs-collection entry, reduced to what the index needs. */
export interface LlmsDocEntry {
  slug: string;
  title: string;
  description: string;
  section: string;
}

/**
 * Section order for the index. The docs sidebar groups by the same `section` frontmatter
 * but leaves the groups in collection order, which is alphabetical by source path — fine
 * for a sidebar you scan, wrong for a list read top to bottom. This runs in the order a
 * reader meets the product: what it is, getting it running, then the guides, then the
 * reference. A section that appears upstream without being listed here sorts in
 * alphabetically after the known ones rather than disappearing.
 */
export const LLMS_SECTION_ORDER: readonly string[] = [
  "Overview",
  "Getting Started",
  "CDK",
  "Networking",
  "Storage & Performance",
  "Troubleshooting",
  "Reference",
  "Service Reference",
];

/** The path a doc's markdown is served at: docs/storage -> /docs/storage.md. */
export function docMarkdownPath(slug: string): string {
  return `/${slug.replace(/^\/+|\/+$/g, "")}.md`;
}

/**
 * Re-points a doc body's internal links at the markdown endpoints.
 *
 * The loader (src/loaders/overcast-docs.ts) has already rewritten every relative markdown
 * link to a site route — `](/docs/services/s3/)`, optionally with a `#fragment`. That is
 * the right target for the HTML page and the wrong one for a reader that asked for
 * markdown: following it lands them back in a rendered page they have to strip. Anything
 * that isn't a known doc slug — an absolute GitHub URL, an on-page anchor, a link to a
 * site page like /support/ — is left exactly as it was.
 */
export function rewriteDocLinksToMarkdown(body: string, docSlugs: ReadonlySet<string>): string {
  return body.replace(/\]\(\/([^)#\s]+)\/(#[^)\s]*)?\)/g, (whole, slug: string, fragment?: string) => {
    if (!docSlugs.has(slug)) return whole;
    return `](${docMarkdownPath(slug)}${fragment ?? ""})`;
  });
}

function absolute(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

/** One line of prose, however the frontmatter happened to wrap it. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function link(origin: string, title: string, path: string, description: string): string {
  const summary = oneLine(description);
  const base = `- [${oneLine(title)}](${absolute(origin, path)})`;
  return summary ? `${base}: ${summary}` : base;
}

/**
 * The service or guide a sub-page belongs to, as a reader-facing name. A sub-page's own
 * title is the bare concern ("Operations", "Limitations") — there are fifty pages called
 * Operations, so the parent has to be in the line or the list is useless.
 */
function parentLabel(slug: string, titleBySlug: ReadonlyMap<string, string>): string | null {
  const service = parseServiceDocSlug(slug);
  if (service?.page != null) {
    return titleBySlug.get(`docs/services/${service.service}`) ?? service.service.toUpperCase();
  }
  const guide = parseGuideDocSlug(slug);
  if (guide?.page != null) return guideLabel(guide.guide);
  return null;
}

function sectionRank(section: string): number {
  const known = LLMS_SECTION_ORDER.indexOf(section);
  return known === -1 ? LLMS_SECTION_ORDER.length : known;
}

function bySection(entries: readonly LlmsDocEntry[]): Array<[string, LlmsDocEntry[]]> {
  const groups = new Map<string, LlmsDocEntry[]>();
  for (const entry of entries) {
    groups.set(entry.section, [...(groups.get(entry.section) ?? []), entry]);
  }
  return [...groups.entries()].sort(([a], [b]) => sectionRank(a) - sectionRank(b) || a.localeCompare(b));
}

export interface LlmsTxtOptions {
  /** Site origin, e.g. https://overcast.sh — every link in the file is absolute. */
  origin: string;
  docs: readonly LlmsDocEntry[];
  /** The one-line blockquote under the H1. Passed in from src/pages/llms.txt.ts rather
   * than written here: it is published copy, and copy-lint only reads src/pages. */
  summary: string;
  /** Paragraphs between the summary and the first section, same reason. */
  notes: readonly string[];
  /** Overridable so a test can pin the list; defaults to the site's own routes. */
  sitePages?: readonly SitePage[];
}

export function buildLlmsTxt({ origin, docs, summary, notes, sitePages = SITE_PAGES }: LlmsTxtOptions): string {
  const titleBySlug = new Map(docs.map((doc) => [doc.slug, doc.title]));
  const sorted = [...docs].sort((a, b) => a.slug.localeCompare(b.slug));
  const landings = sorted.filter((doc) => parentLabel(doc.slug, titleBySlug) === null);
  const subPages = sorted.filter((doc) => parentLabel(doc.slug, titleBySlug) !== null);

  const lines: string[] = ["# Overcast", "", `> ${oneLine(summary)}`];

  for (const note of notes) {
    lines.push("", oneLine(note));
  }

  if (sitePages.length > 0) {
    lines.push("", "## Site", "", ...sitePages.map((page) => link(origin, page.title, page.path, page.description)));
  }

  for (const [section, entries] of bySection(landings)) {
    lines.push("", `## ${section}`, "");
    for (const entry of entries) {
      lines.push(link(origin, entry.title, docMarkdownPath(entry.slug), entry.description));
    }
  }

  if (subPages.length > 0) {
    lines.push(
      "",
      "## Optional",
      "",
      "Sub-pages of the services and guides above, listed for completeness. Read the landing page first and follow it down to the one you need.",
      "",
    );
    for (const entry of subPages) {
      const parent = parentLabel(entry.slug, titleBySlug);
      lines.push(link(origin, `${parent} — ${entry.title}`, docMarkdownPath(entry.slug), entry.description));
    }
  }

  return `${lines.join("\n")}\n`;
}
