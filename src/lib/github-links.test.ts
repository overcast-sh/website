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
