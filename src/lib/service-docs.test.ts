// Unit tests for the nested-guide slug parsing. Run with `npm test` (Node's built-in test
// runner, with its native TypeScript stripping — service-docs.ts deliberately imports
// nothing, so nothing here needs a bundler or an Astro build).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupGuideDocs,
  parseGuideDocSlug,
  // The explicit extension is what lets Node's test runner resolve this without a bundler
  // (changelog-parse.test.ts imports its module the same way, for the same reason).
} from "./service-docs.ts";

describe("parseGuideDocSlug", () => {
  it("matches an ordinary guide's landing page at docs/<guide>", () => {
    assert.deepEqual(parseGuideDocSlug("docs/networking"), { guide: "networking", page: null });
  });

  it("matches an ordinary guide's sub-page at docs/<guide>/<page>", () => {
    assert.deepEqual(parseGuideDocSlug("docs/networking/hostnames"), { guide: "networking", page: "hostnames" });
  });

  // docs/migration-from-localstack.md predates the nested-guide split (Overcast PR #1627)
  // and kept its existing slug for backwards compatibility, so the `migration` guide's
  // landing page lives at a different path than every other guide's — see
  // GUIDE_LANDING_SLUGS in service-docs.ts.
  it("resolves the migration guide's landing page to its pre-existing slug", () => {
    assert.deepEqual(parseGuideDocSlug("docs/migration-from-localstack"), { guide: "migration", page: null });
  });

  it("still nests migration sub-pages under docs/migration/, not docs/migration-from-localstack/", () => {
    assert.deepEqual(parseGuideDocSlug("docs/migration/environment-variables"), {
      guide: "migration",
      page: "environment-variables",
    });
  });

  it("does not treat docs/migration-from-localstack/<page> as a migration sub-page", () => {
    assert.equal(parseGuideDocSlug("docs/migration-from-localstack/environment-variables"), null);
  });

  it("returns null for a doc that isn't a nested guide", () => {
    assert.equal(parseGuideDocSlug("docs/troubleshooting"), null);
  });
});

describe("groupGuideDocs", () => {
  it("groups the migration landing page and its sub-pages under one guide key", () => {
    const docs = [
      { slug: "docs/migration-from-localstack", title: "Migrating from LocalStack" },
      { slug: "docs/migration/environment-variables", title: "Environment Variables" },
      { slug: "docs/migration/endpoints", title: "Endpoints" },
      { slug: "docs/migration/differences", title: "Differences" },
    ];

    const groups = groupGuideDocs(docs);
    const migration = groups.get("migration");

    assert.ok(migration, "expected a migration guide group");
    assert.equal(migration!.label, "Migration");
    assert.equal(migration!.landing?.slug, "docs/migration-from-localstack");
    // None of these three keys appear in SUBPAGE_ORDER, so groupGuideDocs falls back to
    // alphabetical (see sortSubPages in service-docs.ts).
    assert.deepEqual(
      migration!.subPages.map((page) => page.slug),
      ["docs/migration/differences", "docs/migration/endpoints", "docs/migration/environment-variables"],
    );
  });
});
