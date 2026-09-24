import type { APIRoute, GetStaticPaths } from "astro";
import { getCompatIndex, getCompatRelease, getServiceNaming } from "../../../lib/compat-data";
import { buildExplorerIndex } from "../../../lib/compat-report";

// https://overcast.sh/compat/data/<tag>.json — the explorer's compact index for one release
// (see ExplorerIndex in src/lib/compat-report.ts). Fetched only by /compat/explore/, so the
// static pages never pay for it. The full report is the release asset itself.
export const getStaticPaths: GetStaticPaths = async () => {
  const index = await getCompatIndex();
  return index.map((entry) => ({ params: { tag: entry.tag } }));
};

export const GET: APIRoute = async ({ params }) => {
  const release = await getCompatRelease(params.tag as string);
  if (!release) return new Response("not found", { status: 404 });
  const body = buildExplorerIndex(release.report, await getServiceNaming(), release.previous ?? undefined);
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
