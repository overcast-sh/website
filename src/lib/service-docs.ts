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

/** The four concern pages every service page splits into, in the order a service is read.
 * They are a fixed vocabulary upstream, so they lead a service's sub-nav whatever else it
 * grows; anything beyond them is ordered by the landing page (see subPageOrderFrom). */
const SUBPAGE_ORDER = ["operations", "limitations", "troubleshooting", "examples"];

/** A doc entry, reduced to what this module needs — keeps it usable from anywhere
 * without dragging in `astro:content`'s generated types. */
export interface ServiceDocLike {
  slug: string;
  title: string;
  /** The page's own markdown body. Only ever read off a *landing* page, and only to
   * recover the order its routing table lists the group's sub-pages in — see
   * subPageOrderFrom. Optional: a caller that doesn't have it gets title order. */
  body?: string;
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

/** Consecutive `| ... |` lines, i.e. the markdown tables in a body, each as its rows. */
function markdownTables(body: string): string[][] {
  const tables: string[][] = [];
  let rows: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      rows.push(trimmed);
      continue;
    }
    if (rows.length > 0) tables.push(rows);
    rows = [];
  }
  if (rows.length > 0) tables.push(rows);
  return tables;
}

/**
 * The order a landing page's routing table lists its sub-pages in.
 *
 * Every split landing opens with a table that routes the reader — one row per sub-page,
 * "here is the question this page answers" — and that order is the author's, running from
 * the first thing you need to the last. Sorting the sub-nav and sidebar by slug instead
 * threw it away and left eleven networking entries looking shuffled, because the nav shows
 * titles and the sort was reading filenames.
 *
 * The routing table is found rather than declared: it is the first table in the body that
 * links two or more of the group's own sub-pages. Two is what separates it from an
 * incidental table that happens to link one (`https.md`'s per-platform table links
 * `manual-trust` from its Linux row, well above the real routing table). A row is credited
 * with whichever sub-pages it links, so it works whether the link is the row's first cell
 * (networking, cli, configuration) or its second (migration-from-localstack, which asks
 * the question first). Returns an empty list when there is no such table — a landing that
 * routes in prose, or a group with a single sub-page — and callers fall back to title order.
 *
 * @param body    the landing page's markdown, links already rewritten to site routes
 * @param subPages the group's sub-pages, whose `slug` is what is looked for in the table
 */
export function subPageOrderFrom(body: string, subPages: readonly ServiceSubPage[]): string[] {
  for (const rows of markdownTables(body)) {
    const found: string[] = [];
    for (const row of rows) {
      // Where in this row each sub-page is linked, so a row that links two of them credits
      // them left to right rather than in whatever order the group happens to hold them.
      const inRow = subPages
        .filter((page) => !found.includes(page.key))
        // The slug is matched with a trailing boundary so a group holding both `egress`
        // and `routed-egress` can't credit a row linking one to the other. `[./]` in front
        // anchors it to a path segment, matching both the rewritten `/docs/x/y/` route and
        // a raw `./x/y.md` target.
        .map((page) => ({ key: page.key, at: row.search(new RegExp(`[./]${escapeForRegExp(page.slug)}(?![\\w-])`)) }))
        .filter((match) => match.at !== -1)
        .sort((a, b) => a.at - b.at);
      found.push(...inRow.map((match) => match.key));
    }
    if (found.length >= 2) return found;
  }
  return [];
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A landing page's routing order is read once per body, not once per page that renders a
// nav: every docs page groups the whole collection, and there are ~185 of them. The body
// is checked, not just the slug, so a second body for the same slug (which only happens in
// tests — a build has one) recomputes instead of serving the first one's answer.
const orderCache = new Map<string, { body: string; order: readonly string[] }>();

function cachedSubPageOrder(landing: ServiceDocLike | undefined, subPages: readonly ServiceSubPage[]): readonly string[] {
  if (!landing?.body) return [];
  const cached = orderCache.get(landing.slug);
  if (cached && cached.body === landing.body) return cached.order;
  const order = subPageOrderFrom(landing.body, subPages);
  orderCache.set(landing.slug, { body: landing.body, order });
  return order;
}

/**
 * Sub-pages in reading order: for a service the four concern pages first, in their fixed
 * order, then everything else in the landing page's routing-table order, then whatever the
 * landing does not link, by title. A guide has no fixed vocabulary, so `concernsFirst` is
 * off there and its landing decides the lot.
 */
function sortSubPages(
  pages: ServiceSubPage[],
  { landing, concernsFirst }: { landing?: ServiceDocLike; concernsFirst: boolean },
): ServiceSubPage[] {
  const concernRank = (page: ServiceSubPage) => {
    if (!concernsFirst) return -1;
    const rank = SUBPAGE_ORDER.indexOf(page.key);
    return rank === -1 ? -1 : rank;
  };
  // Deriving the order means reading the landing's whole body, so skip it when there is
  // nothing left for it to order — the common service, whose sub-pages are all concerns.
  const needsLandingOrder = pages.some((page) => concernRank(page) === -1);
  const routed = needsLandingOrder ? cachedSubPageOrder(landing, pages) : [];
  const routedRank = (page: ServiceSubPage) => {
    const index = routed.indexOf(page.key);
    return index === -1 ? routed.length : index;
  };

  return [...pages].sort((a, b) => {
    const concernA = concernRank(a);
    const concernB = concernRank(b);
    if (concernA !== concernB) {
      // A concern page outranks anything the landing routes; two concerns keep SUBPAGE_ORDER.
      if (concernA === -1 || concernB === -1) return concernA === -1 ? 1 : -1;
      return concernA - concernB;
    }
    const routedA = routedRank(a);
    const routedB = routedRank(b);
    if (routedA !== routedB) return routedA - routedB;
    return a.label.localeCompare(b.label);
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
    group.subPages = sortSubPages(group.subPages, { landing: group.landing, concernsFirst: true });
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
    group.subPages = sortSubPages(group.subPages, { landing: group.landing, concernsFirst: false });
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
