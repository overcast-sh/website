/**
 * /<slug>.md — every synced doc, as markdown.
 *
 * `/docs/storage/` renders the HTML page; `/docs/storage.md` returns the markdown it was
 * rendered from. That pairing is what makes the links in /llms.txt worth following: a
 * reader that wanted markdown gets markdown instead of a page of site chrome to strip.
 *
 * The rest param carries the whole slug, `docs/` prefix included, so this sits at the
 * pages root rather than under pages/docs/ — a nested `[...slug].md.ts` would serve
 * /docs/docs/storage.md. It does not collide with pages/docs/[...slug].astro: that route
 * ends in a trailing slash and this one in `.md`.
 *
 * The body is served as the loader left it, with one change — internal links are
 * re-pointed at these .md routes (see rewriteDocLinksToMarkdown). No frontmatter is
 * synthesised on top: every doc opens with its own `# Title` heading, so the title is
 * already in the file, and a reader that wanted the metadata has /llms.txt.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { rewriteDocLinksToMarkdown } from "../lib/llms-txt";

export const getStaticPaths: GetStaticPaths = async () => {
  const docs: CollectionEntry<"docs">[] = await getCollection("docs");
  // Built once here rather than per page: the rewrite only re-points links whose target is
  // a doc this site actually publishes, and that needs the whole set to decide.
  const slugs = new Set<string>(docs.map((doc) => doc.data.slug));

  return docs.map((doc) => ({
    params: { slug: doc.data.slug },
    props: { body: rewriteDocLinksToMarkdown(doc.body ?? "", slugs) },
  }));
};

export const GET: APIRoute = ({ props }) => {
  const { body } = props as { body: string };

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
};
