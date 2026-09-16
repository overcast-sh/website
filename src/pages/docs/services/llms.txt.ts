/**
 * /docs/services/llms.txt — the service reference index, and the leaf of the three.
 *
 * This is the file that grows: every service Overcast covers adds a landing page and its
 * operations, limitations and examples pages. Keeping it here rather than in the root index
 * is what stops that growth reaching an agent that only wanted to know what Overcast is.
 *
 * Entries sort by slug, which puts each service directly above its own sub-pages.
 */
import type { APIRoute } from "astro";
import { llmsTxtResponse } from "../../../lib/llms-response";

const summary =
  "Per-service reference for Overcast, a local emulator for AWS APIs: what each emulated service implements, where it stops, and how to drive it.";

const notes = [
  "Every link below ends in `.md` and returns that page as markdown. The same page renders as HTML at the path without the extension.",
  "A service's own page comes first, followed by its sub-pages. Coverage is per operation, not per service — the support matrix at https://overcast.sh/support/ has the implementation status of each one.",
];

export const GET: APIRoute = ({ site }) =>
  llmsTxtResponse({
    site,
    scope: "services",
    title: "Overcast service reference",
    summary,
    notes,
  });
