/**
 * Per-service doc structure. Upstream service docs are a landing page plus optional
 * sub-pages:
 *
 *   docs/services/s3.md              -> /docs/services/s3/            (Overview)
 *   docs/services/s3/operations.md   -> /docs/services/s3/operations/
 *   docs/services/s3/limitations.md  -> /docs/services/s3/limitations/
 *
 * The sub-pages are optional and a release may ship none of them, so everything here is
 * driven by what the docs collection actually contains — never by the list of names below.
 */

const SERVICES_PREFIX = "docs/services/";

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
  /** Path under the service, e.g. `operations`. */
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

/**
 * The sub-nav items for a service: Overview (the landing page) followed by whichever
 * sub-pages exist. Empty when the service has no sub-pages — a strip whose only entry is
 * the page you're already on is chrome with nothing in it, so callers render nothing.
 */
export function serviceNavItems(group: ServiceDocGroup | undefined): ServiceSubPage[] {
  if (!group?.landing || group.subPages.length === 0) return [];
  return [{ key: "", label: "Overview", slug: group.landing.slug }, ...group.subPages];
}
