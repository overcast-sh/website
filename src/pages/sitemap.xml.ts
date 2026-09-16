import type { APIRoute } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { SITE_PAGE_PATHS } from "../lib/site-pages";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin || "https://overcast.sh";
  const docs: CollectionEntry<"docs">[] = await getCollection("docs");
  // The .md twin of every doc (src/pages/[...slug].md.ts) is deliberately absent: it is the
  // same page in another format, and listing both would put two URLs per doc in front of a
  // crawler. /llms.txt is absent for the same reason — it indexes this list, it isn't a
  // page in it. robots.txt points at it instead.
  const routes = [
    ...SITE_PAGE_PATHS,
    ...docs.map((doc) => `/${doc.data.slug}/`),
  ].sort();

  const urls = routes
    .map((route) => `  <url><loc>${escapeXml(new URL(route, origin).toString())}</loc></url>`)
    .join("\n");

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
};
