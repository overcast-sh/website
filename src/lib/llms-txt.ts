/**
 * Builds the site's llms.txt indexes — https://llmstxt.org, v2 — and the link rewriting
 * their companion raw markdown endpoints need.
 *
 * Three routes make the docs readable without a browser:
 *
 * - `/<path>/index.md` (src/pages/[...slug].md.ts) serves any page as markdown — a doc's own
 *   body, or, for the site's own pages, markdown built from the data they render from. Every
 *   route here is directory-style, which is the case v2 names explicitly: a URL with no file
 *   name takes index.md. Docs keep `/<slug>.md` as an alias, but nothing links to it.
 * - `/llms.txt`, `/docs/llms.txt` and `/docs/services/llms.txt` index those. An llms.txt
 *   covers the pages under its own path and the most specific one wins, so an agent after a
 *   service reads ~140 lines about services rather than the whole site.
 *
 * The split is the point. v2 is explicit that the file "stays small enough to fit in
 * context" and that "the detail lives behind the links, and is fetched only when needed" —
 * one flat index of every page is the thing it is arguing against. Listing all ~190 docs
 * inline came to 50KB, two-thirds of it service pages, and it grew with every service
 * added. Now the root file is the orientation layer and stays roughly fixed in size, and
 * only the leaf it points at grows.
 *
 * There is no `## Optional` section here. In v1 it told context-expansion tooling what to
 * drop; v2 retired that tooling and with it the section's mechanical meaning, leaving a
 * convention that would only describe which links we think matter less. Nesting says it
 * better: secondary detail isn't flagged in the file, it's in a different file.
 *
 * Nothing here reads the filesystem or `astro:content`, so `npm test` can exercise it under
 * Node's test runner without a build — same reason service-docs.ts is shaped that way, and
 * this module imports that one for the slug parsing it already does.
 */
import { guideLabel, parseGuideDocSlug, parseServiceDocSlug } from "./service-docs.ts";
import { type SitePage } from "./site-pages.ts";

/** A docs-collection entry, reduced to what an index needs. */
export interface LlmsDocEntry {
  slug: string;
  title: string;
  description: string;
  section: string;
}

/** A more specific llms.txt, linked from a broader one. */
export interface LlmsIndexLink {
  path: string;
  title: string;
  description: string;
}

/**
 * How much of a doc's description an index line carries. The frontmatter descriptions are
 * written as 2–3 clause page summaries and run to ~220 characters upstream; a line whose
 * job is to help an agent choose between links needs far less, and 190 of them at full
 * length was most of the file's weight.
 */
export const DESCRIPTION_BUDGET = 110;

/**
 * Section order for an index. The docs sidebar groups by the same `section` frontmatter but
 * leaves the groups in collection order, which is alphabetical by source path — fine for a
 * sidebar you scan, wrong for a list read top to bottom. This runs in the order a reader
 * meets the product: what it is, getting it running, then the guides, then the reference. A
 * section that appears upstream without being listed here sorts in alphabetically after the
 * known ones rather than disappearing.
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

const SERVICES_PREFIX = "docs/services";

/**
 * The canonical markdown path for a page, which is what every link here and every
 * rel="alternate" points at.
 *
 * v2 gives two spellings — `.md` appended to the full URL, or the extension replaced — and
 * then names the case this site is entirely made of: "URLs without file names should append
 * index.html.md or index.md instead". Every route here is directory-style, so `/docs/storage/`
 * takes `/docs/storage/index.md`.
 */
export function markdownIndexPath(path: string): string {
  return `/${path.replace(/^\/+|\/+$/g, "")}/index.md`.replace(/^\/\//, "/");
}

/**
 * The extension-replaced spelling, `/docs/storage.md`. Also allowed by v2, widely guessed at
 * by tooling, and the URL this site published for its docs in #57 — so [...slug].md.ts keeps
 * serving it as an alias. Nothing links to it.
 */
export function docMarkdownPath(slug: string): string {
  return `/${slug.replace(/^\/+|\/+$/g, "")}.md`;
}

/**
 * The most specific llms.txt covering a page, for its `rel="describedby"` link.
 *
 * v2's answer to the commonest question its first two years raised — given a page, how does
 * an agent find the index that covers it without guessing. Ordered most specific first,
 * which is the rule the spec gives for choosing between files that both apply.
 */
export function llmsIndexPathFor(pathname: string): string {
  if (pathname.startsWith(`/${SERVICES_PREFIX}/`)) return `/${SERVICES_PREFIX}/llms.txt`;
  if (pathname.startsWith("/docs/")) return "/docs/llms.txt";
  return "/llms.txt";
}

/** Every service page: the services index, each service, and each service's sub-pages. */
export function isServiceDoc(slug: string): boolean {
  return slug === SERVICES_PREFIX || slug.startsWith(`${SERVICES_PREFIX}/`);
}

/** A page nested under a service or a guide, rather than one of their landing pages. */
export function isSubPage(slug: string): boolean {
  return parseServiceDocSlug(slug)?.page != null || parseGuideDocSlug(slug)?.page != null;
}

/**
 * Which docs each published index lists.
 *
 * `root` is the orientation layer: landing pages only, and no services at all — an agent
 * that wants a service follows the link to the services index instead of reading 137 lines
 * about them first. `docs` covers everything under /docs/ bar services, sub-pages included,
 * because a guide and its sub-pages are the same size of subject. `services` is the leaf
 * that grows.
 */
export const LLMS_SCOPES = {
  root: (doc: LlmsDocEntry) => !isServiceDoc(doc.slug) && !isSubPage(doc.slug),
  docs: (doc: LlmsDocEntry) => !isServiceDoc(doc.slug),
  services: (doc: LlmsDocEntry) => isServiceDoc(doc.slug),
} satisfies Record<string, (doc: LlmsDocEntry) => boolean>;

export type LlmsScope = keyof typeof LLMS_SCOPES;

/**
 * Re-points a doc body's internal links at the markdown endpoints.
 *
 * The loader (src/loaders/overcast-docs.ts) has already rewritten every relative markdown
 * link to a site route — `](/docs/services/s3/)`, optionally with a `#fragment`. That is the
 * right target for the HTML page and the wrong one for a reader that asked for markdown:
 * following it lands them back in a rendered page they have to strip. Anything that isn't a
 * known doc slug — an absolute GitHub URL, an on-page anchor, a link to a site page like
 * /support/ — is left exactly as it was.
 */
export function rewriteDocLinksToMarkdown(body: string, docSlugs: ReadonlySet<string>): string {
  return body.replace(/\]\(\/([^)#\s]+)\/(#[^)\s]*)?\)/g, (whole, slug: string, fragment?: string) => {
    if (!docSlugs.has(slug)) return whole;
    return `](${markdownIndexPath(slug)}${fragment ?? ""})`;
  });
}

/** One line of prose, however the frontmatter happened to wrap it. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Shortens a description to the budget, cutting at a clause boundary where there is one in
 * the back of the budget and at a word boundary otherwise — "…what auto resolves to," reads
 * better than "…what auto resolves t". Descriptions inside the budget are untouched.
 */
export function trimDescription(value: string, budget = DESCRIPTION_BUDGET): string {
  const text = oneLine(value);
  if (text.length <= budget) return text;

  const window = text.slice(0, budget + 1);
  const clause = Math.max(window.lastIndexOf(", "), window.lastIndexOf(": "), window.lastIndexOf(" — "));
  const word = window.lastIndexOf(" ");
  const cut = clause >= budget * 0.6 ? clause : word;

  return `${text.slice(0, cut > 0 ? cut : budget).replace(/[\s,:;—-]+$/, "")}…`;
}

function absolute(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

function link(origin: string, title: string, path: string, description: string): string {
  const summary = trimDescription(description);
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
    return titleBySlug.get(`${SERVICES_PREFIX}/${service.service}`) ?? service.service.toUpperCase();
  }
  const guide = parseGuideDocSlug(slug);
  if (guide?.page != null) return guideLabel(guide.guide);
  return null;
}

function sectionRank(section: string): number {
  const known = LLMS_SECTION_ORDER.indexOf(section);
  return known === -1 ? LLMS_SECTION_ORDER.length : known;
}

/**
 * Grouped by section, sections in reading order, entries by slug within one. Slug order is
 * what clusters a service or guide with its own sub-pages: docs/services/s3 sorts directly
 * above docs/services/s3/limitations, so the list reads as a service and its parts rather
 * than an alphabetical shuffle of both.
 */
function bySection(entries: readonly LlmsDocEntry[]): Array<[string, LlmsDocEntry[]]> {
  const groups = new Map<string, LlmsDocEntry[]>();
  for (const entry of entries) {
    groups.set(entry.section, [...(groups.get(entry.section) ?? []), entry]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => sectionRank(a) - sectionRank(b) || a.localeCompare(b))
    .map(([section, group]) => [section, [...group].sort((a, b) => a.slug.localeCompare(b.slug))]);
}

export interface LlmsTxtOptions {
  /** Site origin, e.g. https://overcast.sh — every link in the file is absolute. */
  origin: string;
  /** The H1: the only section the spec requires. */
  title: string;
  /** The one-line blockquote under the H1. Passed in from the route rather than written
   * here: it is published copy, and copy-lint only reads src/pages. */
  summary: string;
  /** Paragraphs between the summary and the first section, same reason. */
  notes: readonly string[];
  /** Docs this index covers — already narrowed to its scope by the caller. */
  docs: readonly LlmsDocEntry[];
  /** The site's own pages. Root index only; they sit above /docs/. */
  sitePages?: readonly SitePage[];
  /** More specific indexes below this one. */
  indexes?: readonly LlmsIndexLink[];
}

export function buildLlmsTxt({ origin, title, summary, notes, docs, sitePages = [], indexes = [] }: LlmsTxtOptions): string {
  const titleBySlug = new Map(docs.map((doc) => [doc.slug, doc.title]));
  const lines: string[] = [`# ${oneLine(title)}`, "", `> ${oneLine(summary)}`];

  for (const note of notes) {
    lines.push("", oneLine(note));
  }

  if (sitePages.length > 0) {
    // These have markdown twins too (src/lib/site-markdown.ts), so link the markdown —
    // an index that points an agent back at HTML has sent it the wrong way.
    lines.push("", "## Site", "", ...sitePages.map((page) => link(origin, page.title, markdownIndexPath(page.path), page.description)));
  }

  for (const [section, entries] of bySection(docs)) {
    lines.push("", `## ${section}`, "");
    for (const entry of entries) {
      const parent = parentLabel(entry.slug, titleBySlug);
      const label = parent ? `${parent} — ${entry.title}` : entry.title;
      lines.push(link(origin, label, markdownIndexPath(entry.slug), entry.description));
    }
  }

  if (indexes.length > 0) {
    lines.push("", "## More detail", "", ...indexes.map((index) => link(origin, index.title, index.path, index.description)));
  }

  return `${lines.join("\n")}\n`;
}
