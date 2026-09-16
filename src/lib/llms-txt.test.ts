// Unit tests for /llms.txt and the raw-markdown link rewriting. Run with `npm test`
// (Node's built-in test runner, with its native TypeScript stripping — llms-txt.ts imports
// only service-docs.ts and site-pages.ts, neither of which needs a bundler).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLlmsTxt,
  docMarkdownPath,
  rewriteDocLinksToMarkdown,
  type LlmsDocEntry,
  type LlmsTxtOptions,
} from "./llms-txt.ts";

const ORIGIN = "https://overcast.sh";

function doc(slug: string, title: string, section: string, description = `About ${title}.`): LlmsDocEntry {
  return { slug, title, section, description };
}

// The published wording lives in src/pages/llms.txt.ts, where copy-lint can see it. These
// stand in for it so a reworded summary doesn't fail a test about structure.
const build = (options: Omit<LlmsTxtOptions, "summary" | "notes">): string =>
  buildLlmsTxt({ summary: "A local AWS emulator.", notes: ["Links below end in .md."], ...options });

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

describe("rewriteDocLinksToMarkdown", () => {
  const slugs = new Set(["docs/storage", "docs/services/s3"]);

  it("re-points a link to a published doc at its markdown route", () => {
    assert.equal(
      rewriteDocLinksToMarkdown("See [storage](/docs/storage/).", slugs),
      "See [storage](/docs/storage.md).",
    );
  });

  it("keeps the fragment on a deep link", () => {
    assert.equal(
      rewriteDocLinksToMarkdown("See [buckets](/docs/services/s3/#buckets).", slugs),
      "See [buckets](/docs/services/s3.md#buckets).",
    );
  });

  // The loader sends links it can't resolve to a doc off to GitHub, and the site's own
  // pages (/support/, /downloads/) are not in the docs collection at all. Neither has a
  // .md twin, so neither may be rewritten.
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
      "[a](/docs/storage.md) and [b](/docs/services/s3.md)",
    );
  });
});

describe("buildLlmsTxt", () => {
  const docs: LlmsDocEntry[] = [
    doc("docs/overview", "Overcast", "Overview"),
    doc("docs/install", "Install", "Getting Started"),
    doc("docs/storage", "Storage", "Storage & Performance"),
    doc("docs/networking", "Networking", "Networking"),
    doc("docs/networking/hostnames", "Hostnames", "Networking"),
    doc("docs/services/s3", "S3", "Service Reference"),
    doc("docs/services/s3/operations", "Operations", "Service Reference"),
  ];

  const output = build({ origin: ORIGIN, docs });

  it("opens with the H1 and a blockquote summary, as the format requires", () => {
    const [heading, blank, summary] = output.split("\n");
    assert.equal(heading, "# Overcast");
    assert.equal(blank, "");
    assert.match(summary, /^> /);
  });

  it("links every doc at its absolute markdown URL", () => {
    assert.match(output, /^- \[Storage\]\(https:\/\/overcast\.sh\/docs\/storage\.md\): About Storage\.$/m);
  });

  it("orders sections by the reading order, not alphabetically", () => {
    const sections = [...output.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(sections, [
      "Site",
      "Overview",
      "Getting Started",
      "Networking",
      "Storage & Performance",
      "Service Reference",
      "Optional",
    ]);
  });

  it("puts a section it has never seen after the known ones and before Optional", () => {
    const withUnknown = build({ origin: ORIGIN, docs: [...docs, doc("docs/whatsit", "Whatsit", "Zebra")] });
    const sections = [...withUnknown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(sections.slice(-2), ["Zebra", "Optional"]);
  });

  it("holds service and guide sub-pages back to Optional", () => {
    const [, optional] = output.split("\n## Optional\n");
    assert.match(optional, /\[S3 — Operations\]\(https:\/\/overcast\.sh\/docs\/services\/s3\/operations\.md\)/);
    assert.match(optional, /\[Networking — Hostnames\]\(https:\/\/overcast\.sh\/docs\/networking\/hostnames\.md\)/);
    // The landing pages stay above it.
    assert.doesNotMatch(optional, /\[S3\]\(/);
  });

  it("lists the site's own pages, which have no markdown twin, at their HTML paths", () => {
    assert.match(output, /^- \[Support matrix\]\(https:\/\/overcast\.sh\/support\/\): /m);
  });

  it("puts each entry on one line however the frontmatter wrapped it", () => {
    const wrapped = build({
      origin: ORIGIN,
      docs: [doc("docs/storage", "Storage", "Reference", "Pick a backend,\nand know what survives\na restart.")],
      sitePages: [],
    });
    assert.match(wrapped, /^- \[Storage\]\(\S+\): Pick a backend, and know what survives a restart\.$/m);
  });

  it("omits the colon for a doc with no description", () => {
    const bare = build({ origin: ORIGIN, docs: [doc("docs/storage", "Storage", "Reference", "")], sitePages: [] });
    assert.match(bare, /^- \[Storage\]\(https:\/\/overcast\.sh\/docs\/storage\.md\)$/m);
  });

  it("ends with a single trailing newline", () => {
    assert.match(output, /[^\n]\n$/);
  });
});
