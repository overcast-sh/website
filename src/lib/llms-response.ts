/**
 * The glue between the docs collection and an llms.txt route.
 *
 * Kept out of llms-txt.ts so that module stays free of `astro:content` and can be unit
 * tested under Node's test runner, and out of the routes themselves so the three of them
 * differ only in the two things that should differ: which docs they cover, and what they
 * say. The wording stays in each route, where copy-lint reads it.
 */
import { getCollection, type CollectionEntry } from "astro:content";
import { buildLlmsTxt, LLMS_SCOPES, type LlmsIndexLink, type LlmsScope } from "./llms-txt.ts";
import type { SitePage } from "./site-pages.ts";

export interface LlmsRouteOptions {
  /** `Astro.site` / the endpoint's `site`, which is set in astro.config.mjs. */
  site: URL | undefined;
  scope: LlmsScope;
  title: string;
  summary: string;
  notes: readonly string[];
  sitePages?: readonly SitePage[];
  indexes?: readonly LlmsIndexLink[];
}

export async function llmsTxtResponse({ site, scope, ...rest }: LlmsRouteOptions): Promise<Response> {
  const docs: CollectionEntry<"docs">[] = await getCollection("docs");

  const body = buildLlmsTxt({
    origin: site?.origin || "https://overcast.sh",
    docs: docs
      .map((doc) => ({
        slug: doc.data.slug,
        title: doc.data.title,
        description: doc.data.description,
        section: doc.data.section,
      }))
      .filter(LLMS_SCOPES[scope]),
    ...rest,
  });

  return new Response(body, {
    headers: {
      // Markdown, but served as plain text so following the link in a browser shows the
      // file rather than downloading it. This is what llmstxt.org's own site does.
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
