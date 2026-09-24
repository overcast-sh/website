/**
 * The site's own routes — every published page that isn't a synced doc.
 *
 * Two published files need this list and had no way of agreeing on it:
 * src/pages/sitemap.xml.ts, which wants the paths, and src/pages/llms.txt.ts, which wants
 * a line of description alongside each. Docs carry their own title and description in the
 * collection; these pages are hand-authored here, so their descriptions are too — copied
 * from the `description` each one passes to SiteLayout, which is what a reader arriving
 * from a search result already sees.
 *
 * Routes that only exist to keep an old URL resolving (/compare/localstack/,
 * /docs/operation-manifest/) are deliberately absent: they render a redirect stub marked
 * `noindex`, so neither a sitemap nor an llms.txt should be advertising them.
 */
export interface SitePage {
  /** Absolute site path, with the trailing slash Astro's directory build format emits. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
}

export const SITE_PAGES: readonly SitePage[] = [
  {
    path: "/",
    title: "Overcast",
    description: "Free and open-source local AWS emulator for development and CI.",
  },
  {
    path: "/docs/",
    title: "Documentation",
    description:
      "Start with the quickstart, then route to the guides for building against Overcast, running it, or looking one thing up.",
  },
  {
    path: "/support/",
    title: "Support matrix",
    description: "Overcast service and operation implementation status.",
  },
  {
    path: "/compat/",
    title: "Compatibility report",
    description:
      "Overcast's compatibility test results across six AWS SDKs, the AWS CLI and the CDK, with the reason for every result that does not pass.",
  },
  {
    path: "/compat/explore/",
    title: "Explore compatibility results",
    description: "Search and filter every Overcast compatibility test result by operation, client, reason and tracking issue.",
  },
  {
    path: "/downloads/",
    title: "Downloads",
    description: "Download Overcast Docker images and native binaries.",
  },
  {
    path: "/releases/",
    title: "Releases",
    description: "Overcast release history and release assets.",
  },
  {
    path: "/console/",
    title: "Web console",
    description:
      "The browser UI bundled with Overcast: inbox, event stream, request traces, topology map, and a browser for every emulated service.",
  },
  {
    path: "/contributing/",
    title: "Contributing",
    description: "Contribute to Overcast and the Overcast website.",
  },
];

/** Just the paths, for callers that only route (the sitemap). */
export const SITE_PAGE_PATHS: readonly string[] = SITE_PAGES.map((page) => page.path);
