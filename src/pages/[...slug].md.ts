/**
 * Every markdown twin on the site, from one route.
 *
 * llmstxt.org v2 asks that a page an agent might need also be served as clean markdown "at
 * the same URL as the original page", and gives the form for a URL with no file name:
 * append index.md. Every route here is directory-style — `/docs/storage/`, `/support/`,
 * `/` — so the spec form is `/docs/storage/index.md`, `/support/index.md`, `/index.md`, and
 * that is what rel="alternate" and the llms.txt indexes point at.
 *
 * Synced docs are additionally served at `/docs/storage.md`. That extension-replaced form is
 * the other one v2 allows, it is what much of the ecosystem guesses at, and it is the URL
 * this site published in #57 — so it stays as an alias rather than breaking. Both spellings
 * return the same bytes.
 *
 * A doc's markdown is the loader's own body, with internal links re-pointed at these routes
 * (rewriteDocLinksToMarkdown). The site's own pages have no markdown behind them, so theirs
 * is built from the same data the .astro page renders from — see src/lib/site-markdown.ts,
 * which explains why the two prose pages get a deliberately short twin.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { docMarkdownPath, rewriteDocLinksToMarkdown } from "../lib/llms-txt";
import { getServiceSupport } from "../lib/generated-content";
import { repositoryUrl, websiteGitHubRepo } from "../lib/github-links";
import { newestReleaseWithAssets, sortReleasesNewestFirst } from "../lib/releases";
import { LLMS_SECTION_ORDER } from "../lib/llms-txt";
import {
  consoleMarkdown,
  contributingMarkdown,
  docsIndexMarkdown,
  downloadsMarkdown,
  homeMarkdown,
  releasesMarkdown,
  supportMarkdown,
  type ReleaseLike,
} from "../lib/site-markdown";

const ORIGIN = "https://overcast.sh";

// The quickstart the home and downloads pages print. Written once here and passed to the
// builders so a twin can't show a command the page no longer runs.
const DOCKER_RUN = `docker run --rm \\
  -p 4566:4566 \\
  -p 4567:4567 \\
  ghcr.io/overcast-sh/overcast:latest`;
const FIRST_CALL = `aws --endpoint-url http://localhost:4566 \\
  s3 mb s3://hello-overcast`;
const DOCKER_SLIM = `docker run --rm \\
  -p 4566:4566 \\
  ghcr.io/overcast-sh/overcast-slim:latest`;

export const getStaticPaths: GetStaticPaths = async () => {
  const docs: CollectionEntry<"docs">[] = await getCollection("docs");
  // Built once here rather than per page: the rewrite only re-points links whose target is a
  // doc this site actually publishes, and that needs the whole set to decide.
  const slugs = new Set<string>(docs.map((doc) => doc.data.slug));

  const docPaths = docs.flatMap((doc) => {
    const body = rewriteDocLinksToMarkdown(doc.body ?? "", slugs);
    return [
      { params: { slug: `${doc.data.slug}/index` }, props: { body } },
      // The alias. docMarkdownPath keeps the two spellings defined in one place.
      { params: { slug: docMarkdownPath(doc.data.slug).replace(/^\//, "").replace(/\.md$/, "") }, props: { body } },
    ];
  });

  const support = await getServiceSupport();
  // Sorted and picked over as collection entries, then flattened: the release helpers are
  // generic over `{ data: … }`, and the markdown builders take the plain shape so they stay
  // testable without a collection.
  const releaseEntries: CollectionEntry<"releases">[] = await getCollection("releases");
  const sorted = sortReleasesNewestFirst(releaseEntries);
  const latestWithAssets = newestReleaseWithAssets(sorted);
  const flatten = (release: CollectionEntry<"releases">): ReleaseLike => ({
    tagName: release.data.tagName,
    name: release.data.name,
    publishedAt: release.data.publishedAt,
    url: release.data.url,
    prerelease: release.data.prerelease,
    assets: release.data.assets,
  });
  const releases = sorted.map(flatten);

  // Docs grouped for /docs/index.md the way the sidebar groups them, minus the per-service
  // pages that /docs/services/llms.txt indexes and minus every sub-page, which is the same
  // shape the root llms.txt takes: a landing page you can route from, not a full listing.
  const sections = [...new Set(docs.map((doc) => doc.data.section))]
    .sort((a, b) => {
      const rank = (section: string) =>
        LLMS_SECTION_ORDER.indexOf(section) === -1 ? LLMS_SECTION_ORDER.length : LLMS_SECTION_ORDER.indexOf(section);
      return rank(a) - rank(b) || a.localeCompare(b);
    })
    .map((section) => ({
      section,
      entries: docs
        .filter((doc) => doc.data.section === section && !doc.data.slug.startsWith("docs/services"))
        .map((doc) => ({ title: doc.data.title, slug: doc.data.slug, description: doc.data.description }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    }))
    .filter((group) => group.entries.length > 0);

  const options = { origin: ORIGIN };
  const sitePaths = [
    {
      params: { slug: "index" },
      props: {
        body: homeMarkdown({
          ...options,
          commands: [
            { label: "Run it:", command: DOCKER_RUN },
            { label: "Then talk to it with any AWS client:", command: FIRST_CALL },
          ],
          serviceCount: support.services.length,
          latestVersion: releases[0]?.tagName,
        }),
      },
    },
    { params: { slug: "docs/index" }, props: { body: docsIndexMarkdown({ ...options, sections }) } },
    { params: { slug: "support/index" }, props: { body: supportMarkdown(support, options) } },
    { params: { slug: "releases/index" }, props: { body: releasesMarkdown(releases, options) } },
    {
      params: { slug: "downloads/index" },
      props: {
        body: downloadsMarkdown({
          ...options,
          latest: latestWithAssets ? flatten(latestWithAssets) : undefined,
          commands: [
            { label: "The full image:", command: DOCKER_RUN },
            { label: "Or the slim one, without SQLite-backed storage:", command: DOCKER_SLIM },
          ],
        }),
      },
    },
    { params: { slug: "console/index" }, props: { body: consoleMarkdown(options) } },
    {
      params: { slug: "contributing/index" },
      props: {
        body: contributingMarkdown({
          ...options,
          repositoryUrl: repositoryUrl(),
          websiteRepositoryUrl: repositoryUrl(websiteGitHubRepo),
        }),
      },
    },
  ];

  return [...docPaths, ...sitePaths];
};

export const GET: APIRoute = ({ props }) => {
  const { body } = props as { body: string };

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
};
