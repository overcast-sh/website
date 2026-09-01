import type { APIRoute } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";

const staticRoutes = [
  "/",
  "/compare/localstack/",
  "/contributing/",
  "/downloads/",
  "/releases/",
  "/support/",
];

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin || "https://overcast.sh";
  const docs: CollectionEntry<"docs">[] = await getCollection("docs");
  const routes = [
    ...staticRoutes,
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
