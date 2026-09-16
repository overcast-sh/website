// Unit tests for the llms.txt indexes and the raw-markdown link rewriting. Run with
// `npm test` (Node's built-in test runner, with its native TypeScript stripping —
// llms-txt.ts imports only service-docs.ts and site-pages.ts, neither of which needs a
// bundler).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLlmsTxt,
  docMarkdownPath,
  markdownIndexPath,
  isServiceDoc,
  isSubPage,
  llmsIndexPathFor,
  LLMS_SCOPES,
  rewriteDocLinksToMarkdown,
  trimDescription,
  type LlmsDocEntry,
  type LlmsTxtOptions,
} from "./llms-txt.ts";

const ORIGIN = "https://overcast.sh";

function doc(slug: string, title: string, section: string, description = `About ${title}.`): LlmsDocEntry {
  return { slug, title, section, description };
}

// The published wording lives in each route under src/pages, where copy-lint reads it.
// These stand in for it so a reworded summary doesn't fail a test about structure.
const build = (options: Omit<LlmsTxtOptions, "summary" | "notes" | "title">): string =>
  buildLlmsTxt({ title: "Overcast", summary: "A local AWS emulator.", notes: ["Links below end in .md."], ...options });

const DOCS: LlmsDocEntry[] = [
  doc("docs/overview", "Overview", "Overview"),
  doc("docs/install", "Install", "Getting Started"),
  doc("docs/storage", "Storage", "Storage & Performance"),
  doc("docs/networking", "Networking", "Networking"),
  doc("docs/networking/hostnames", "Hostnames", "Networking"),
  doc("docs/services", "Services", "Service Reference"),
  doc("docs/services/s3", "S3", "Service Reference"),
  doc("docs/services/s3/operations", "Operations", "Service Reference"),
];

describe("markdownIndexPath", () => {
  // The spec: "URLs without file names should append index.html.md or index.md instead".
  // Every route on this site is directory-style, so this is the canonical form for all of
  // them, and it is what the indexes and rel="alternate" point at.
  it("appends index.md to a directory-style page path", () => {
    assert.equal(markdownIndexPath("docs/storage"), "/docs/storage/index.md");
  });

  it("gives the same answer whichever way the path is punctuated", () => {
    assert.equal(markdownIndexPath("/docs/storage/"), "/docs/storage/index.md");
    assert.equal(markdownIndexPath("/support/"), "/support/index.md");
  });

  // The home page: no path at all, and the one case where the extension-replaced spelling
  // has nothing to attach itself to.
  it("maps the site root to /index.md", () => {
    assert.equal(markdownIndexPath("/"), "/index.md");
    assert.equal(markdownIndexPath(""), "/index.md");
  });
});

describe("docMarkdownPath", () => {
  it("appends .md to a doc slug", () => {
    assert.equal(docMarkdownPath("docs/storage"), "/docs/storage.md");
  });

  it("does not double the slash for a slug that already has one", () => {
    assert.equal(docMarkdownPath("/docs/storage"), "/docs/storage.md");
  });

  // The loader strips a slug's trailing slash before storing it, but the routing tables it
  // rewrites links from are full of directory-style targets, so don't depend on that.
  it("drops a trailing slash rather than putting .md after it", () => {
    assert.equal(docMarkdownPath("docs/services/s3/"), "/docs/services/s3.md");
  });
});

describe("llmsIndexPathFor", () => {
  it("sends a service page to the services index", () => {
    assert.equal(llmsIndexPathFor("/docs/services/s3/operations/"), "/docs/services/llms.txt");
  });

  it("sends any other doc to the docs index", () => {
    assert.equal(llmsIndexPathFor("/docs/storage/"), "/docs/llms.txt");
  });

  it("sends a non-docs page to the root index", () => {
    assert.equal(llmsIndexPathFor("/downloads/"), "/llms.txt");
  });

  // "the most specific file applies" — /docs/services/ is covered by the services index it
  // sits above, not by the docs one.
  it("sends the services landing page to the services index", () => {
    assert.equal(llmsIndexPathFor("/docs/services/"), "/docs/services/llms.txt");
  });
});

describe("scopes", () => {
  it("counts the services index page itself as a service page", () => {
    assert.equal(isServiceDoc("docs/services"), true);
    assert.equal(isServiceDoc("docs/services/s3"), true);
    assert.equal(isServiceDoc("docs/storage"), false);
  });

  it("recognises a sub-page of a guide or a service", () => {
    assert.equal(isSubPage("docs/networking/hostnames"), true);
    assert.equal(isSubPage("docs/services/s3/operations"), true);
    assert.equal(isSubPage("docs/networking"), false);
  });

  it("keeps the root index to landing pages with no services", () => {
    const slugs = DOCS.filter(LLMS_SCOPES.root).map((entry) => entry.slug);
    assert.deepEqual(slugs, ["docs/overview", "docs/install", "docs/storage", "docs/networking"]);
  });

  it("gives the docs index everything but services, sub-pages included", () => {
    const slugs = DOCS.filter(LLMS_SCOPES.docs).map((entry) => entry.slug);
    assert.deepEqual(slugs, [
      "docs/overview",
      "docs/install",
      "docs/storage",
      "docs/networking",
      "docs/networking/hostnames",
    ]);
  });

  it("gives the services index the services and nothing else", () => {
    const slugs = DOCS.filter(LLMS_SCOPES.services).map((entry) => entry.slug);
    assert.deepEqual(slugs, ["docs/services", "docs/services/s3", "docs/services/s3/operations"]);
  });

  it("covers every doc across the docs and services scopes, with no overlap", () => {
    const docsScope = DOCS.filter(LLMS_SCOPES.docs);
    const servicesScope = DOCS.filter(LLMS_SCOPES.services);
    assert.equal(docsScope.length + servicesScope.length, DOCS.length);
  });
});

describe("trimDescription", () => {
  it("leaves a description inside the budget alone", () => {
    assert.equal(trimDescription("Short enough."), "Short enough.");
  });

  it("cuts at a clause boundary when there is one late in the budget", () => {
    const text = "Pick a backend, know what survives a restart, and see which artefacts ship with which of them, in detail";
    const trimmed = trimDescription(text, 60);
    assert.equal(trimmed, "Pick a backend, know what survives a restart…");
  });

  it("falls back to a word boundary when no clause boundary is late enough", () => {
    const trimmed = trimDescription("alpha beta gamma delta epsilon zeta eta theta iota kappa", 30);
    assert.ok(trimmed.endsWith("…"), trimmed);
    assert.ok(trimmed.length <= 31, trimmed);
    assert.ok(!trimmed.includes("  "), trimmed);
  });

  it("never leaves dangling punctuation before the ellipsis", () => {
    assert.doesNotMatch(trimDescription("one two three four five six seven eight, nine ten", 40), /[\s,:;—-]…$/);
  });

  it("collapses whitespace however the frontmatter wrapped it", () => {
    assert.equal(trimDescription("Pick a backend,\nand know\nwhat survives."), "Pick a backend, and know what survives.");
  });
});

describe("rewriteDocLinksToMarkdown", () => {
  const slugs = new Set(["docs/storage", "docs/services/s3"]);

  it("re-points a link to a published doc at its markdown route", () => {
    assert.equal(rewriteDocLinksToMarkdown("See [storage](/docs/storage/).", slugs), "See [storage](/docs/storage/index.md).");
  });

  it("keeps the fragment on a deep link", () => {
    assert.equal(
      rewriteDocLinksToMarkdown("See [buckets](/docs/services/s3/#buckets).", slugs),
      "See [buckets](/docs/services/s3/index.md#buckets).",
    );
  });

  // The loader sends links it can't resolve to a doc off to GitHub, and the site's own
  // pages (/support/, /downloads/) are not in the docs collection. They do have markdown
  // twins now, but this rewrite only knows doc slugs — retargeting them is the index's job,
  // not the body rewriter's, so a body link to one is left exactly as the loader wrote it.
  it("leaves a site page that isn't a doc alone", () => {
    assert.equal(rewriteDocLinksToMarkdown("See [support](/support/).", slugs), "See [support](/support/).");
  });

  it("leaves an absolute URL alone", () => {
    const body = "See [the repo](https://github.com/overcast-sh/overcast/blob/main/AGENTS.md).";
    assert.equal(rewriteDocLinksToMarkdown(body, slugs), body);
  });

  it("leaves an on-page anchor alone", () => {
    assert.equal(rewriteDocLinksToMarkdown("See [below](#limits).", slugs), "See [below](#limits).");
  });

  it("rewrites every link in a body, not just the first", () => {
    assert.equal(
      rewriteDocLinksToMarkdown("[a](/docs/storage/) and [b](/docs/services/s3/)", slugs),
      "[a](/docs/storage/index.md) and [b](/docs/services/s3/index.md)",
    );
  });
});

describe("buildLlmsTxt", () => {
  const output = build({ origin: ORIGIN, docs: DOCS.filter(LLMS_SCOPES.docs) });

  it("opens with the H1 and a blockquote summary, as the format requires", () => {
    const [heading, blank, summary] = output.split("\n");
    assert.equal(heading, "# Overcast");
    assert.equal(blank, "");
    assert.match(summary, /^> /);
  });

  it("links every doc at its absolute markdown URL", () => {
    assert.match(output, /^- \[Storage\]\(https:\/\/overcast\.sh\/docs\/storage\/index\.md\): About Storage\.$/m);
  });

  it("orders sections by the reading order, not alphabetically", () => {
    const sections = [...output.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(sections, ["Overview", "Getting Started", "Networking", "Storage & Performance"]);
  });

  it("puts a section it has never seen after the known ones", () => {
    const withUnknown = build({ origin: ORIGIN, docs: [...DOCS.filter(LLMS_SCOPES.docs), doc("docs/x", "X", "Zebra")] });
    const sections = [...withUnknown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.equal(sections.at(-1), "Zebra");
  });

  // Slug order is what puts a guide directly above its own sub-pages instead of
  // interleaving both alphabetically by title.
  it("lists a sub-page under its parent, qualified by the parent's name", () => {
    const networking = output.split("\n## Networking\n")[1].split("\n## ")[0];
    const titles = [...networking.matchAll(/^- \[([^\]]+)\]/gm)].map((match) => match[1]);
    assert.deepEqual(titles, ["Networking", "Networking — Hostnames"]);
  });

  it("qualifies a service sub-page with the service's own title", () => {
    const services = build({ origin: ORIGIN, docs: DOCS.filter(LLMS_SCOPES.services) });
    assert.match(services, /\[S3 — Operations\]\(https:\/\/overcast\.sh\/docs\/services\/s3\/operations\/index\.md\)/);
  });

  it("has no Optional section — v2 retired what it meant", () => {
    assert.doesNotMatch(output, /^## Optional$/m);
  });

  it("links the site's own pages at their markdown twins, not their HTML pages", () => {
    const root = build({
      origin: ORIGIN,
      docs: DOCS.filter(LLMS_SCOPES.root),
      sitePages: [{ path: "/support/", title: "Support matrix", description: "Implementation status." }],
    });
    assert.match(root, /^- \[Support matrix\]\(https:\/\/overcast\.sh\/support\/index\.md\): Implementation status\.$/m);
  });

  it("omits the Site section entirely when there are no site pages", () => {
    assert.doesNotMatch(output, /^## Site$/m);
  });

  it("links the more specific indexes last", () => {
    const root = build({
      origin: ORIGIN,
      docs: DOCS.filter(LLMS_SCOPES.root),
      indexes: [{ path: "/docs/services/llms.txt", title: "Service reference index", description: "Every service." }],
    });
    const sections = [...root.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.equal(sections.at(-1), "More detail");
    assert.match(root, /- \[Service reference index\]\(https:\/\/overcast\.sh\/docs\/services\/llms\.txt\): Every service\.$/m);
  });

  it("trims a long description down to the budget", () => {
    const long = "a".repeat(60) + " " + "b".repeat(80);
    const trimmed = build({ origin: ORIGIN, docs: [doc("docs/storage", "Storage", "Reference", long)] });
    const line = trimmed.split("\n").find((value) => value.startsWith("- [Storage]"));
    assert.ok(line, "no Storage line in the generated index");
    assert.ok(line.length < long.length, line);
    assert.ok(line.endsWith("…"), line);
  });

  it("omits the colon for a doc with no description", () => {
    const bare = build({ origin: ORIGIN, docs: [doc("docs/storage", "Storage", "Reference", "")] });
    assert.match(bare, /^- \[Storage\]\(https:\/\/overcast\.sh\/docs\/storage\/index\.md\)$/m);
  });

  it("ends with a single trailing newline", () => {
    assert.match(output, /[^\n]\n$/);
  });
});
