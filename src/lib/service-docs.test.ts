// Unit tests for the nested-guide slug parsing and sub-page ordering. Run with `npm test`
// (Node's built-in test runner, with its native TypeScript stripping — service-docs.ts
// deliberately imports nothing, so nothing here needs a bundler or an Astro build).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupGuideDocs,
  groupServiceDocs,
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
    // No landing body here, so there is no routing table to read an order off and
    // groupGuideDocs falls back to title order (see sortSubPages in service-docs.ts).
    assert.deepEqual(
      migration!.subPages.map((page) => page.slug),
      ["docs/migration/differences", "docs/migration/endpoints", "docs/migration/environment-variables"],
    );
  });
});

// The nav shows titles, so sorting sub-pages by their filename made a guide's entries look
// unordered — /docs/networking/ listed eleven pages in an order the landing page's own
// routing table disagreed with. These cover reading that order back off the landing.
describe("sub-page order", () => {
  const networkingLanding = (body: string) => ({ slug: "docs/networking", title: "Networking", body });
  const routingTable = [
    "Everything follows from one question: what name does a caller use?",
    "",
    "| Page | Answers |",
    "| --- | --- |",
    "| [Host-routed addressing](/docs/networking/host-routing/) | Which subdomain forms route where |",
    "| [Hostnames that resolve](/docs/networking/hostnames/) | A name that will not resolve |",
    "| [Egress modes](/docs/networking/egress/) | Whether a container reaches the internet |",
    "| [`routed`: egress from your route tables](/docs/networking/routed-egress/) | Per-subnet egress |",
    "| [Networking troubleshooting](/docs/networking/troubleshooting/) | Symptom, cause and fix |",
  ].join("\n");
  const subPages = [
    { slug: "docs/networking/egress", title: "Egress modes" },
    { slug: "docs/networking/host-routing", title: "Host-routed addressing" },
    { slug: "docs/networking/hostnames", title: "Hostnames that resolve for every caller" },
    { slug: "docs/networking/routed-egress", title: "routed: egress from your route tables" },
    { slug: "docs/networking/troubleshooting", title: "Networking troubleshooting" },
  ];

  it("orders a guide's sub-pages the way its landing page's routing table lists them", () => {
    const groups = groupGuideDocs([networkingLanding(routingTable), ...subPages]);

    assert.deepEqual(
      groups.get("networking")!.subPages.map((page) => page.key),
      ["host-routing", "hostnames", "egress", "routed-egress", "troubleshooting"],
    );
  });

  // `troubleshooting` is one of the four service concern names, and it used to be hoisted
  // to the front of every group that held it — including a guide, where the name carries
  // no such convention and the landing lists it last.
  it("does not hoist a guide sub-page that shares a service concern name", () => {
    const groups = groupGuideDocs([networkingLanding(routingTable), ...subPages]);

    assert.equal(groups.get("networking")!.subPages.at(-1)?.key, "troubleshooting");
  });

  // https.md's per-platform table links one sub-page from its Linux row, above the real
  // routing table. One link is an aside; two is a table that routes.
  it("skips a table that links only one sub-page and takes the next one that routes", () => {
    const body = [
      "| Platform | What `overcast https enable` asks for |",
      "| --- | --- |",
      "| Linux | Firefox reads its own store — see [by hand](/docs/https/manual-trust/) |",
      "",
      "| Page | Answers |",
      "| --- | --- |",
      "| [Overcast in Docker over HTTPS](/docs/https/docker/) | Keeping one trust install |",
      "| [Installing the CA by hand](/docs/https/manual-trust/) | A trust store the CLI cannot write |",
      "| [How the local CA works](/docs/https/how-it-works/) | What `enable` mints |",
    ].join("\n");

    const groups = groupGuideDocs([
      { slug: "docs/https", title: "HTTPS and HTTP/2", body },
      { slug: "docs/https/docker", title: "Overcast in Docker over HTTPS" },
      { slug: "docs/https/how-it-works", title: "How the local CA works" },
      { slug: "docs/https/manual-trust", title: "Installing the CA by hand" },
    ]);

    assert.deepEqual(
      groups.get("https")!.subPages.map((page) => page.key),
      ["docker", "manual-trust", "how-it-works"],
    );
  });

  // migration-from-localstack.md asks the reader's question first and links the answer in
  // the second cell, so the order can't be read off first cells alone.
  it("reads the order from a routing table whose links are not in the first cell", () => {
    const body = [
      "| I am asking | Go to |",
      "| --- | --- |",
      "| Which variables still mean something? | [Environment variables](/docs/migration/environment-variables/) |",
      "| Which paths still answer? | [Endpoints and init hooks](/docs/migration/endpoints/) |",
      "| What behaves differently? | [Behavioural differences](/docs/migration/differences/) |",
    ].join("\n");

    const groups = groupGuideDocs([
      { slug: "docs/migration-from-localstack", title: "Migrating from LocalStack", body },
      { slug: "docs/migration/differences", title: "Behavioural differences from LocalStack" },
      { slug: "docs/migration/endpoints", title: "LocalStack endpoints and init hooks" },
      { slug: "docs/migration/environment-variables", title: "LocalStack environment variables" },
    ]);

    assert.deepEqual(
      groups.get("migration")!.subPages.map((page) => page.key),
      ["environment-variables", "endpoints", "differences"],
    );
  });

  it("falls back to title order for a sub-page the routing table does not link", () => {
    const body = [
      "| Page | Answers |",
      "| --- | --- |",
      "| [Egress modes](/docs/networking/egress/) | Whether a container reaches the internet |",
      "| [Hostnames](/docs/networking/hostnames/) | A name that will not resolve |",
    ].join("\n");

    const groups = groupGuideDocs([
      networkingLanding(body),
      { slug: "docs/networking/egress", title: "Egress modes" },
      { slug: "docs/networking/hostnames", title: "Hostnames that resolve for every caller" },
      { slug: "docs/networking/urls", title: "What host and port a URL carries" },
      { slug: "docs/networking/docker-networks", title: "The Docker networks Overcast uses" },
    ]);

    assert.deepEqual(
      groups.get("networking")!.subPages.map((page) => page.key),
      // Routed first, in table order; then the two the table misses, by title
      // ("The Docker networks…" before "What host and port…").
      ["egress", "hostnames", "docker-networks", "urls"],
    );
  });

  it("keeps a service's concern pages first and orders the rest by the landing page", () => {
    const body = [
      "| Page | Answers |",
      "| --- | --- |",
      "| [Bucket policies](/docs/services/s3/policies/) | What S3 evaluates |",
      "| [Addressing styles](/docs/services/s3/addressing/) | Path-style and virtual-hosted |",
    ].join("\n");

    const groups = groupServiceDocs([
      { slug: "docs/services/s3", title: "S3", body },
      { slug: "docs/services/s3/addressing", title: "Addressing styles" },
      { slug: "docs/services/s3/limitations", title: "S3 limitations" },
      { slug: "docs/services/s3/policies", title: "Bucket policies" },
      { slug: "docs/services/s3/operations", title: "S3 operations" },
    ]);

    assert.deepEqual(
      groups.get("s3")!.subPages.map((page) => page.key),
      ["operations", "limitations", "policies", "addressing"],
    );
  });
});
