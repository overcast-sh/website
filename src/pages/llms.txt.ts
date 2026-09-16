/**
 * /llms.txt — the llmstxt.org index of this site, for a reader that arrived without a
 * browser. Generated from the docs collection on every build, so a page added, renamed or
 * dropped upstream shows up here with no list to maintain. The wording, the section order
 * and the site-page list are the only hand-written parts; they live in
 * src/lib/llms-txt.ts and src/lib/site-pages.ts.
 *
 * The companion raw-markdown routes every link here points at are in [...slug].md.ts.
 */
import type { APIRoute } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { buildLlmsTxt } from "../lib/llms-txt";

const summary =
  "Overcast is a free, MIT-licensed local emulator for AWS APIs. Run it with Docker, point supported AWS CLI, CDK, or SDK workflows at http://localhost:4566, and inspect what your app creates in the bundled web console.";

const notes = [
  "Every documentation link below ends in `.md` and returns that page as markdown. The same page renders as HTML at the path without the extension, so https://overcast.sh/docs/storage.md and https://overcast.sh/docs/storage/ hold the same content.",
  "Coverage varies by service and by operation, and these pages describe the current release. The support matrix has the implementation status of every service and operation.",
];

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin || "https://overcast.sh";
  const docs: CollectionEntry<"docs">[] = await getCollection("docs");

  const body = buildLlmsTxt({
    origin,
    summary,
    notes,
    docs: docs.map((doc) => ({
      slug: doc.data.slug,
      title: doc.data.title,
      description: doc.data.description,
      section: doc.data.section,
    })),
  });

  return new Response(body, {
    headers: {
      // Markdown, but served as plain text so following the link in a browser shows the
      // file rather than downloading it. This is what llmstxt.org's own site does.
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
