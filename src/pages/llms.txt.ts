/**
 * /llms.txt — the site's root index, in the llmstxt.org v2 format.
 *
 * The orientation layer, and deliberately the smallest of the three: the site's own pages,
 * the docs landing pages, and a pointer down to /docs/llms.txt and /docs/services/llms.txt.
 * Service pages are not listed here at all — there are ~140 of them, they are what grows
 * when Overcast covers another service, and an agent that wants one follows a link rather
 * than reading past them. Scope selection lives in LLMS_SCOPES (src/lib/llms-txt.ts).
 *
 * The companion raw-markdown routes every doc link points at are in [...slug].md.ts.
 */
import type { APIRoute } from "astro";
import { llmsTxtResponse } from "../lib/llms-response";
import { SITE_PAGES } from "../lib/site-pages";

const summary =
  "Overcast is a free, MIT-licensed local emulator for AWS APIs. Run it with Docker, point supported AWS CLI, CDK, or SDK workflows at http://localhost:4566, and inspect what your app creates in the bundled web console.";

const notes = [
  "Every documentation link below ends in `.md` and returns that page as markdown. The same page renders as HTML at the path without the extension, so https://overcast.sh/docs/storage.md and https://overcast.sh/docs/storage/ hold the same content.",
  "Coverage varies by service and by operation, and these pages describe the current release. The support matrix has the implementation status of every service and operation.",
];

const indexes = [
  {
    path: "/docs/llms.txt",
    title: "Documentation index",
    description: "Every guide and reference page under /docs/, including the sub-pages this file leaves out.",
  },
  {
    path: "/docs/services/llms.txt",
    title: "Service reference index",
    description: "Every emulated service, with its operations, limitations and examples.",
  },
];

export const GET: APIRoute = ({ site }) =>
  llmsTxtResponse({
    site,
    scope: "root",
    title: "Overcast",
    summary,
    notes,
    sitePages: SITE_PAGES,
    indexes,
  });
