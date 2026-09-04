// Unit tests for the upstream-content rewrites applied while docs are loaded. Run with
// `npm test` (Node's built-in test runner and its native TypeScript stripping — nothing
// here needs a bundler or an Astro build).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  rewriteContainerImageBadge,
  rewriteLegacyOrgReferences,
  // The explicit extension is what lets Node's test runner resolve this without a bundler
  // (service-docs.test.ts imports its module the same way, for the same reason).
} from "./github-links.ts";

describe("rewriteLegacyOrgReferences", () => {
  it("rewrites a plain legacy reference with no new-org mention on the line", () => {
    const legacy = "See github.com/neaox/overcast and ghcr.io/neaox/overcast-slim for details.";
    assert.equal(
      rewriteLegacyOrgReferences(legacy),
      "See github.com/overcast-sh/overcast and ghcr.io/overcast-sh/overcast-slim for details.",
    );
  });

  it("rewrites a bare Neaox token with no new-org mention on the line", () => {
    assert.equal(rewriteLegacyOrgReferences("Built by Neaox."), "Built by overcast-sh.");
  });

  // The alpha.39 org-rename release note (overcast-sh/overcast#1641-adjacent) is the
  // motivating case: it documents the rename with an explicit "old -> new" line and a
  // migration line, both mentioning the new org name alongside the old one. Rewriting
  // either turns it into a same-to-same no-op that reads as broken.
  it("leaves an explicit old -> new migration line untouched", () => {
    const line =
      "  repo `github.com/Neaox/overcast` -> `github.com/overcast-sh/overcast`; images now publish as `ghcr.io/overcast-sh/overcast[:tag]`";
    assert.equal(rewriteLegacyOrgReferences(line), line);
  });

  it("leaves a migration instruction line that names both the new and old org untouched", () => {
    const line =
      "  migration: update imports to `github.com/overcast-sh/overcast` and pull `ghcr.io/overcast-sh/overcast[:tag]`, not `ghcr.io/neaox/overcast`. Old module versions and `Neaox` URLs still resolve";
    assert.equal(rewriteLegacyOrgReferences(line), line);
  });

  it("rewrites other lines in the same release note while skipping only the migration lines", () => {
    const body = [
      "- **BREAKING** [release] the GitHub org and Go module path moved to `overcast-sh`.",
      "  repo `github.com/Neaox/overcast` -> `github.com/overcast-sh/overcast`; images now publish as `ghcr.io/overcast-sh/overcast[:tag]`",
      "  migration: update imports to `github.com/overcast-sh/overcast` and pull `ghcr.io/overcast-sh/overcast[:tag]`, not `ghcr.io/neaox/overcast`. Old module versions and `Neaox` URLs still resolve",
      "",
      "- [docs] see github.com/neaox/overcast for the archived docs.",
    ].join("\n");

    const rewritten = rewriteLegacyOrgReferences(body);
    const lines = rewritten.split("\n");

    assert.equal(lines[1], "  repo `github.com/Neaox/overcast` -> `github.com/overcast-sh/overcast`; images now publish as `ghcr.io/overcast-sh/overcast[:tag]`");
    assert.equal(
      lines[2],
      "  migration: update imports to `github.com/overcast-sh/overcast` and pull `ghcr.io/overcast-sh/overcast[:tag]`, not `ghcr.io/neaox/overcast`. Old module versions and `Neaox` URLs still resolve",
    );
    assert.equal(lines[4], "- [docs] see github.com/overcast-sh/overcast for the archived docs.");
  });

  it("passes an empty body straight through", () => {
    assert.equal(rewriteLegacyOrgReferences(""), "");
  });
});

// TEMPORARY alongside rewriteContainerImageBadge itself — delete this block once the synced
// release contains overcast-sh/overcast#1641.
describe("rewriteContainerImageBadge", () => {
  const brokenBadge =
    "[![Container image](https://img.shields.io/badge/ghcr.io-overcast-sh%2Fovercast-blue?logo=docker&logoColor=white)](https://github.com/overcast-sh/overcast/pkgs/container/overcast)";
  const fixedBadge =
    "[![Container image](https://img.shields.io/badge/ghcr.io-overcast--sh%2Fovercast-blue?logo=docker&logoColor=white)](https://github.com/overcast-sh/overcast/pkgs/container/overcast)";

  it("doubles the dash inside overcast-sh so shields.io stops reading it as a field separator", () => {
    assert.equal(rewriteContainerImageBadge(brokenBadge), fixedBadge);
  });

  it("leaves an already-escaped badge alone, so the rewrite is a no-op once #1641 ships", () => {
    assert.equal(rewriteContainerImageBadge(fixedBadge), fixedBadge);
  });

  it("touches nothing else on the page", () => {
    const page = "See ghcr.io/overcast-sh/overcast and https://img.shields.io/badge/License-MIT-yellow.svg for more.";
    assert.equal(rewriteContainerImageBadge(page), page);
  });

  it("repairs a badge the legacy-org rewrite has just respelled from `neaox`", () => {
    const legacy = "https://img.shields.io/badge/ghcr.io-neaox%2Fovercast-blue?logo=docker";
    assert.equal(
      rewriteContainerImageBadge(rewriteLegacyOrgReferences(legacy)),
      "https://img.shields.io/badge/ghcr.io-overcast--sh%2Fovercast-blue?logo=docker",
    );
  });

  it("passes an empty body straight through", () => {
    assert.equal(rewriteContainerImageBadge(""), "");
  });
});
