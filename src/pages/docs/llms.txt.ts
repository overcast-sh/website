/**
 * /docs/llms.txt — the documentation index.
 *
 * An llms.txt covers the pages under its own path, and where more than one applies the most
 * specific wins, so this one answers for everything under /docs/ except the service pages
 * that /docs/services/llms.txt answers for. Unlike the root index it lists sub-pages: a
 * guide and its sub-pages are the same size of subject, and there are ~50 of them rather
 * than ~140.
 */
import type { APIRoute } from "astro";
import { llmsTxtResponse } from "../../lib/llms-response";

const summary =
  "The guides and references for Overcast, a free, MIT-licensed local emulator for AWS APIs: pointing AWS clients at it, running it, and working out what it did.";

const notes = [
  "Every link below ends in `.md` and returns that page as markdown. The same page renders as HTML at the path without the extension.",
  "Per-service pages are indexed separately, in /docs/services/llms.txt.",
];

const indexes = [
  {
    path: "/docs/services/llms.txt",
    title: "Service reference index",
    description: "Every emulated service, with its operations, limitations and examples.",
  },
];

export const GET: APIRoute = ({ site }) =>
  llmsTxtResponse({
    site,
    scope: "docs",
    title: "Overcast documentation",
    summary,
    notes,
    indexes,
  });
