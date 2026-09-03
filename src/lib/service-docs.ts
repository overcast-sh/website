/**
 * Nested doc groups: a landing page plus optional sub-pages, split out of what used to be
 * one long upstream file. Two shapes share this file because they share the same
 * landing+subpages rendering (sub-nav strip, sidebar nesting, breadcrumb):
 *
 *  - Services — many groups under one prefix, one per service:
 *      docs/services/s3.md              -> /docs/services/s3/            (Overview)
 *      docs/services/s3/operations.md   -> /docs/services/s3/operations/
 *      docs/services/s3/limitations.md  -> /docs/services/s3/limitations/
 *
 *  - Guides — a single top-level doc that grew sub-pages of its own (Overcast PR #1617
 *    split docs/networking.md, docs/cli.md and docs/configuration.md this way):
 *      docs/networking.md               -> /docs/networking/             (Overview)
 *      docs/networking/hostnames.md     -> /docs/networking/hostnames/
 *      docs/networking/vpcs.md          -> /docs/networking/vpcs/
 *
 * In both shapes the sub-pages are optional and a release may ship none of them, so
 * everything here is driven by what the docs collection actually contains — never by a
 * list of expected sub-page names.
 */

const SERVICES_PREFIX = "docs/services/";

/** Guide docs that may have sub-pages nested under a sibling docs/<guide>/ directory.
 * Unlike docs/services/**, there is exactly one group per name here — the guide's own
 * landing page — so this is a fixed list of names rather than anything parsed from the
 * path. A guide with no sub-pages in a given release (the common case for most of these
 * today) still works fine: nothing below requires a sub-page to exist. */
// Exported (not just used internally) so the site-search grouping in SiteLayout.astro can
// label a guide sub-page's search hits from the same source instead of keeping its own
// hand-maintained list — see the sectionFor() usage there.
export const NESTED_GUIDES: Record<string, string> = {
  networking: "Networking",
  cli: "CLI",
  configuration: "Configuration",
  cdk: "CDK",
  https: "HTTPS",
  performance: "Performance",
  migration: "Migration",
};

/** Guide keys whose landing page kept a filename other than docs/<guide>.md. Every guide
 * here follows docs/<guide>.md except `migration`: docs/migration-from-localstack.md
 * predates the nested-guide split (Overcast PR #1627) and its slug/URL stayed put for
 * backwards compatibility, while its new sub-pages moved in under docs/migration/ — the
 * same convention every other guide's sub-pages use. Only the landing lookup needs the
 * override; the sub-page prefix below is still built from the guide key itself. */
const GUIDE_LANDING_SLUGS: Record<string, string> = {
  migration: "migration-from-localstack",
};

/** Sub-page order in the sub-nav and the sidebar. Anything upstream adds that isn't
 * listed falls in after these, alphabetically, labelled from its own frontmatter title. */
const SUBPAGE_ORDER = ["operations", "limitations", "troubleshooting", "examples"];

/** A doc entry, reduced to what this module needs — keeps it usable from anywhere
 * without dragging in `astro:content`'s generated types. */
export interface ServiceDocLike {
  slug: string;
  title: string;
}

export interface ServiceSubPage {
  /** Path under the group, e.g. `operations` or `hostnames`. */
  key: string;
  label: string;
  slug: string;
}

export interface ServiceDocGroup {
  /** The service's doc slug, e.g. `s3` — note this is the *doc* name, which for a few
   * services differs from the support data's service id (`elb` vs `elbv2`). */
  service: string;
  landing?: ServiceDocLike;
  subPages: ServiceSubPage[];
}

export interface GuideDocGroup {
  /** The guide's key, e.g. `networking`. */
  guide: string;
  /** Reader-facing label for the guide, e.g. `CLI` for the `cli` key. */
  label: string;
  landing?: ServiceDocLike;
  subPages: ServiceSubPage[];
}

/**
 * Splits a docs-collection slug into the service it belongs to and, for a sub-page, the
 * page within it. Returns null for anything that isn't a service page — including
 * `docs/services` itself, which is the services index.
 */
export function parseServiceDocSlug(slug: string): { service: string; page: string | null } | null {
  if (!slug.startsWith(SERVICES_PREFIX)) return null;
  const rest = slug.slice(SERVICES_PREFIX.length);
  if (!rest) return null;
  const [service, ...tail] = rest.split("/");
  if (!service) return null;
  return { service, page: tail.length > 0 ? tail.join("/") : null };
}

/**
 * Same idea as parseServiceDocSlug, but for a guide landing page (`docs/<guide>`) and its
 * sub-pages (`docs/<guide>/<page>`). Returns null for anything that isn't one of
 * NESTED_GUIDES — including every other top-level doc, which never nests.
 */
export function parseGuideDocSlug(slug: string): { guide: string; page: string | null } | null {
  for (const guide of Object.keys(NESTED_GUIDES)) {
    const landingSlug = `docs/${GUIDE_LANDING_SLUGS[guide] ?? guide}`;
    if (slug === landingSlug) return { guide, page: null };
    const subPagePrefix = `docs/${guide}/`;
    if (slug.startsWith(subPagePrefix)) return { guide, page: slug.slice(subPagePrefix.length) };
  }
  return null;
}

export function guideLabel(guide: string): string {
  return NESTED_GUIDES[guide] ?? guide;
}

function labelFor(page: ServiceSubPage["key"], title: string): string {
  const known = SUBPAGE_ORDER.indexOf(page);
  if (known === -1) return title;
  return page[0].toUpperCase() + page.slice(1);
}

function sortSubPages(pages: ServiceSubPage[]): ServiceSubPage[] {
  return [...pages].sort((a, b) => {
    const rankA = SUBPAGE_ORDER.indexOf(a.key);
    const rankB = SUBPAGE_ORDER.indexOf(b.key);
    if (rankA !== rankB) return (rankA === -1 ? SUBPAGE_ORDER.length : rankA) - (rankB === -1 ? SUBPAGE_ORDER.length : rankB);
    return a.key.localeCompare(b.key);
  });
}

/** Every service that has at least one doc page, keyed by service doc slug. */
export function groupServiceDocs(docs: readonly ServiceDocLike[]): Map<string, ServiceDocGroup> {
  const groups = new Map<string, ServiceDocGroup>();

  for (const doc of docs) {
    const parsed = parseServiceDocSlug(doc.slug);
    if (!parsed) continue;
    const group = groups.get(parsed.service) ?? { service: parsed.service, subPages: [] };
    if (parsed.page === null) {
      group.landing = doc;
    } else {
      group.subPages.push({ key: parsed.page, label: labelFor(parsed.page, doc.title), slug: doc.slug });
    }
    groups.set(parsed.service, group);
  }

  for (const group of groups.values()) {
    group.subPages = sortSubPages(group.subPages);
  }

  return groups;
}

/** Every guide that has at least a landing page, keyed by guide key. Present even when a
 * release ships no sub-pages for it yet — a group with an empty subPages array is normal,
 * not an error (see serviceNavItems, which renders nothing in that case anyway). */
export function groupGuideDocs(docs: readonly ServiceDocLike[]): Map<string, GuideDocGroup> {
  const groups = new Map<string, GuideDocGroup>();

  for (const doc of docs) {
    const parsed = parseGuideDocSlug(doc.slug);
    if (!parsed) continue;
    const group = groups.get(parsed.guide) ?? { guide: parsed.guide, label: guideLabel(parsed.guide), subPages: [] };
    if (parsed.page === null) {
      group.landing = doc;
    } else {
      group.subPages.push({ key: parsed.page, label: labelFor(parsed.page, doc.title), slug: doc.slug });
    }
    groups.set(parsed.guide, group);
  }

  for (const group of groups.values()) {
    group.subPages = sortSubPages(group.subPages);
  }

  return groups;
}

/**
 * The sub-nav items for a service or guide group: Overview (the landing page) followed by
 * whichever sub-pages exist. Empty when the group has no sub-pages — a strip whose only
 * entry is the page you're already on is chrome with nothing in it, so callers render
 * nothing.
 */
export function serviceNavItems(group: { landing?: ServiceDocLike; subPages: ServiceSubPage[] } | undefined): ServiceSubPage[] {
  if (!group?.landing || group.subPages.length === 0) return [];
  return [{ key: "", label: "Overview", slug: group.landing.slug }, ...group.subPages];
}
