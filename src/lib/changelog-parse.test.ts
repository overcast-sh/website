// Unit tests for the release-notes parser. Run with `npm test` (Node's built-in test runner,
// with its native TypeScript stripping — changelog-parse.ts deliberately imports nothing, so
// nothing here needs a bundler or an Astro build).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  categoryForHeading,
  cleanInlineMarkdown,
  findReleaseNotesLines,
  parseBulletUnit,
  splitHeadingBlocks,
  splitIntoUnits,
  splitLongEntryProse,
  summarizeMarkdown,
  // The explicit extension is what lets Node's test runner resolve this without a bundler
  // (scripts/sync-overcast-content.ts imports the same way, for the same reason).
} from "./changelog-parse.ts";

/** A release body in the shape release.yml publishes: boilerplate sections, then the assembled
 * "## Release Notes". The Changed entry is the fixture the rendering rules are pinned against —
 * a summary, two detail lines, inline code carrying underscores, and a migration line. */
const releaseBody = `# Overcast v0.0.1-alpha.39

## Docker Images

- Pull: \`ghcr.io/overcast-sh/overcast:0.0.1-alpha.39\`

## Native Binaries

| Asset | SHA256 |
| ----- | ------ |
| \`overcast-linux-amd64\` | \`d1581506\` |

## Release Notes

### Added

- [lambda] \`LAMBDA_RUNTIME_API_HOST=auto|<address>\` pins the address containers dial.
  \`auto\` probes the host, which is what every release before this one did.
  an explicit address skips the probe entirely, for a host the probe gets wrong.

### Changed

- **BREAKING** [router/cli] \`POST /_overcast/debug/reset\` moved to \`POST /_overcast/reset\`.
  the debug-gated path is gone, so \`OVERCAST_DEBUG\` no longer gates a reset.
  \`/_overcast/reset/{service}\` resets one service, as before.
  migration: call \`/_overcast/reset\` instead of \`/_overcast/debug/reset\`

- [web] the connection toast replaced the topbar banner

### Fixed

- **Networking (client-facing URLs)** — a pre-fragment-format bullet, left exactly as written

## Verification

- Something after the release notes that must not be parsed as a changelog entry
`;

function releaseNotesUnits(body: string, heading: string) {
  const lines = findReleaseNotesLines(body.split("\n"));
  assert.ok(lines, "expected a Release Notes section");
  const block = splitHeadingBlocks(lines).find((candidate) => candidate.headingText === heading);
  assert.ok(block, `expected a "${heading}" heading block`);
  return splitIntoUnits(block.content);
}

describe("findReleaseNotesLines", () => {
  it("bounds the section at the next heading of equal-or-higher level", () => {
    const lines = findReleaseNotesLines(releaseBody.split("\n"));
    assert.ok(lines);
    assert.ok(lines.some((line) => line.startsWith("### Changed")));
    assert.ok(!lines.some((line) => line.includes("must not be parsed")));
  });

  it("returns null when the body has no Release Notes heading", () => {
    assert.equal(findReleaseNotesLines(["# Title", "", "some prose"]), null);
  });
});

describe("categoryForHeading", () => {
  it("recognizes the assembled category headings", () => {
    assert.equal(categoryForHeading("Added"), "added");
    assert.equal(categoryForHeading("Security:"), "security");
    assert.equal(categoryForHeading("Verification"), undefined);
  });
});

describe("splitIntoUnits", () => {
  it("keeps a bullet's indented continuation lines attached to it", () => {
    const units = releaseNotesUnits(releaseBody, "Changed");
    assert.equal(units.length, 2);
    assert.equal(units[0].type, "bullet");
    assert.equal(units[0].lines.length, 4);
    assert.equal(units[1].lines.length, 1);
  });
});

describe("parseBulletUnit", () => {
  it("keeps the summary, every detail line and the migration note apart", () => {
    const [unit] = releaseNotesUnits(releaseBody, "Changed");
    const parsed = parseBulletUnit(unit);
    assert.ok(parsed);

    assert.equal(parsed.breaking, true);
    assert.deepEqual(parsed.areas, ["router", "cli"]);
    assert.equal(parsed.summary, "`POST /_overcast/debug/reset` moved to `POST /_overcast/reset`.");
    assert.deepEqual(parsed.details, [
      "the debug-gated path is gone, so `OVERCAST_DEBUG` no longer gates a reset.",
      "`/_overcast/reset/{service}` resets one service, as before.",
    ]);
    assert.equal(parsed.migration, "call `/_overcast/reset` instead of `/_overcast/debug/reset`");
  });

  it("keeps underscores inside inline code, in the summary and in every detail line", () => {
    const [unit] = releaseNotesUnits(releaseBody, "Added");
    const parsed = parseBulletUnit(unit);
    assert.ok(parsed);

    assert.match(parsed.summary, /`LAMBDA_RUNTIME_API_HOST=auto\|<address>`/);
    assert.equal(parsed.details.length, 2);
    assert.ok(parsed.details.every((detail) => !detail.includes("  ")), "detail lines are trimmed");
  });

  it("does not merge detail lines into the summary, however many there are", () => {
    const parsed = parseBulletUnit({
      type: "bullet",
      lines: ["- [networking] summary line", "  one", "  two", "  three", "  four", "  five"],
    });
    assert.ok(parsed);
    assert.equal(parsed.summary, "summary line");
    assert.equal(parsed.details.length, 5);
    assert.equal(parsed.migration, null);
  });

  it("parses a bullet with no continuation lines", () => {
    const units = releaseNotesUnits(releaseBody, "Changed");
    const parsed = parseBulletUnit(units[1]);
    assert.ok(parsed);
    assert.deepEqual(parsed.areas, ["web"]);
    assert.deepEqual(parsed.details, []);
  });

  it("returns null for a pre-fragment-format bullet, so it renders as raw markdown", () => {
    const [unit] = releaseNotesUnits(releaseBody, "Fixed");
    assert.equal(parseBulletUnit(unit), null);
  });

  it("returns null rather than dropping one of two migration lines", () => {
    const parsed = parseBulletUnit({
      type: "bullet",
      lines: ["- [state] the v1 on-disk layout is gone", "  migration: export first", "  migration: then import"],
    });
    assert.equal(parsed, null);
  });

  it("returns null for an empty migration line", () => {
    assert.equal(parseBulletUnit({ type: "bullet", lines: ["- [state] gone", "  migration:"] }), null);
  });
});

describe("cleanInlineMarkdown", () => {
  it("leaves underscores inside inline code alone", () => {
    assert.equal(
      cleanInlineMarkdown("`LAMBDA_RUNTIME_API_HOST` pins the address"),
      "LAMBDA_RUNTIME_API_HOST pins the address",
    );
    assert.equal(cleanInlineMarkdown("`POST /_overcast/debug/reset` moved"), "POST /_overcast/debug/reset moved");
  });

  it("still strips emphasis and links outside code", () => {
    assert.equal(cleanInlineMarkdown("**BREAKING** _really_ [docs](https://example.com)"), "BREAKING really docs");
  });
});

describe("summarizeMarkdown", () => {
  it("skips the Docker/binary boilerplate and keeps env var names intact", () => {
    const summary = summarizeMarkdown(releaseBody);
    assert.ok(!summary.includes("ghcr.io"), "docker boilerplate is skipped");
    assert.ok(summary.includes("LAMBDA_RUNTIME_API_HOST"), "env var underscores survive");
  });
});

describe("splitLongEntryProse", () => {
  it("leaves a short line whole", () => {
    assert.deepEqual(splitLongEntryProse("a short summary"), { lead: "a short summary", rest: null });
  });

  it("splits a long legacy one-liner at its first sentence boundary", () => {
    const text =
      "the connection toast replaced the topbar banner. it now reports the daemon's own state. " +
      "the banner is gone entirely, along with the layout shift it caused on every reconnect.";
    const { lead, rest } = splitLongEntryProse(text);
    assert.equal(lead, "the connection toast replaced the topbar banner.");
    assert.ok(rest?.startsWith("it now reports"));
  });

  it("never splits inside an inline code span", () => {
    const text = `pins the address containers dial for the Runtime API with \`overcast start --host 127.0.0.1:9001\`, ${"x".repeat(120)}`;
    const { lead } = splitLongEntryProse(text);
    assert.equal((lead.match(/`/g) ?? []).length % 2, 0, "backticks stay balanced");
  });
});
