// Unit tests for the screenshot audit. Run with `npm test` (Node's built-in test runner,
// with its native TypeScript stripping — screenshot-audit.ts imports nothing, so nothing
// here needs a bundler or an image library).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditVerdict,
  BLANK_FRAME_RATIO,
  changedPixelRatio,
  dominantColourRatio,
  formatComparisonTable,
  formatPercent,
  isBlankFrame,
  REVIEW_CHANGE_RATIO,
  type CaptureWarning,
  type ScreenshotComparison,
} from "./screenshot-audit.ts";

/** An RGBA buffer of `pixels` pixels, painted from a per-index colour function. */
function frame(pixels: number, colour: (index: number) => [number, number, number, number]): Buffer {
  const buffer = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i++) buffer.set(colour(i), i * 4);
  return buffer;
}

const solid = (pixels: number) => frame(pixels, () => [255, 255, 255, 255]);

describe("dominantColourRatio", () => {
  it("is 1 for a frame of one colour", () => {
    assert.equal(dominantColourRatio(solid(100)), 1);
  });

  it("is 1 for an empty buffer, so nothing is mistaken for content", () => {
    assert.equal(dominantColourRatio(Buffer.alloc(0)), 1);
  });

  it("reports the share taken by the commonest colour", () => {
    // 3 white, 1 black.
    const buffer = frame(4, (i) => (i === 3 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    assert.equal(dominantColourRatio(buffer), 0.75);
  });

  it("treats a colour that differs only in alpha as a different colour", () => {
    const buffer = frame(2, (i) => [255, 255, 255, i === 0 ? 255 : 0]);
    assert.equal(dominantColourRatio(buffer), 0.5);
  });
});

describe("isBlankFrame", () => {
  it("rejects a frame of a single colour", () => {
    assert.equal(isBlankFrame(solid(1000)), true);
  });

  it("accepts a frame with real content in it", () => {
    // Every tenth pixel differs: 90% dominant, comfortably under the threshold.
    const buffer = frame(1000, (i) => (i % 10 === 0 ? [10, 20, 30, 255] : [255, 255, 255, 255]));
    assert.equal(isBlankFrame(buffer), false);
  });

  // A page that renders a header and nothing else is the failure this exists for, and it
  // sits just the wrong side of the line.
  it("rejects a frame that is 99% one colour", () => {
    const buffer = frame(1000, (i) => (i < 10 ? [10, 20, 30, 255] : [255, 255, 255, 255]));
    assert.equal(dominantColourRatio(buffer), 0.99);
    assert.equal(isBlankFrame(buffer), true);
    assert.ok(0.99 >= BLANK_FRAME_RATIO);
  });
});

describe("changedPixelRatio", () => {
  it("is 0 for identical frames", () => {
    assert.equal(changedPixelRatio(solid(100), solid(100)), 0);
  });

  it("is 1 when every pixel differs", () => {
    const black = frame(100, () => [0, 0, 0, 255]);
    assert.equal(changedPixelRatio(solid(100), black), 1);
  });

  it("counts the pixels that moved", () => {
    const after = frame(100, (i) => (i < 25 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    assert.equal(changedPixelRatio(solid(100), after), 0.25);
  });

  // Animations are frozen and the clock is paused, so the tolerance is only ever absorbing
  // rounding on a gradient or a glyph edge — not a real change.
  it("ignores a difference within the tolerance", () => {
    const nudged = frame(100, () => [250, 250, 250, 255]);
    assert.equal(changedPixelRatio(solid(100), nudged), 0);
  });

  it("counts a difference past the tolerance", () => {
    const nudged = frame(100, () => [240, 240, 240, 255]);
    assert.equal(changedPixelRatio(solid(100), nudged), 1);
  });

  it("refuses buffers of different sizes rather than guessing", () => {
    assert.throws(() => changedPixelRatio(solid(100), solid(50)), /different lengths/);
  });
});

describe("auditVerdict", () => {
  const small: ScreenshotComparison = { name: "a.png", kind: "changed", changedRatio: 0.01 };

  it("auto-merges when every image moved a little and nothing was logged", () => {
    assert.deepEqual(auditVerdict([small], []), { verdict: "auto", reasons: [] });
  });

  it("holds for review past the change threshold", () => {
    const big: ScreenshotComparison = { name: "b.png", kind: "changed", changedRatio: REVIEW_CHANGE_RATIO };
    const { verdict, reasons } = auditVerdict([small, big], []);
    assert.equal(verdict, "review");
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /`b\.png` changed by 25\.0%/);
  });

  it("holds for review on a new screenshot, which has no baseline to judge it against", () => {
    const { verdict, reasons } = auditVerdict([{ name: "c.png", kind: "new", changedRatio: null }], []);
    assert.equal(verdict, "review");
    assert.match(reasons[0], /is new/);
  });

  it("holds for review when an image changed size", () => {
    const { verdict, reasons } = auditVerdict([{ name: "d.png", kind: "resized", changedRatio: null }], []);
    assert.equal(verdict, "review");
    assert.match(reasons[0], /changed dimensions/);
  });

  // A console.error or a failed request doesn't fail the capture — a noisy log shouldn't
  // wedge the refresh — but it is never merged unseen either.
  it("holds for review when the page logged something, however small the diff", () => {
    const warnings: CaptureWarning[] = [{ scenario: "console-inbox-dark", message: "console.error: boom" }];
    const { verdict, reasons } = auditVerdict([small], warnings);
    assert.equal(verdict, "review");
    assert.match(reasons[0], /console-inbox-dark` logged: console\.error: boom/);
  });

  it("gives every reason, not just the first", () => {
    const { reasons } = auditVerdict(
      [
        { name: "b.png", kind: "changed", changedRatio: 0.9 },
        { name: "c.png", kind: "new", changedRatio: null },
      ],
      [{ scenario: "s", message: "m" }],
    );
    assert.equal(reasons.length, 3);
  });

  it("auto-merges an empty run rather than asking about nothing", () => {
    assert.equal(auditVerdict([], []).verdict, "auto");
  });
});

describe("formatPercent", () => {
  it("keeps a tiny non-zero change visible instead of rounding it to 0.0%", () => {
    assert.equal(formatPercent(0.0001), "<0.1%");
  });

  it("reports an unchanged image as 0.0%", () => {
    assert.equal(formatPercent(0), "0.0%");
  });

  it("reports an ordinary change to one decimal place", () => {
    assert.equal(formatPercent(0.1234), "12.3%");
  });
});

describe("formatComparisonTable", () => {
  it("says so plainly when nothing changed", () => {
    assert.equal(formatComparisonTable([]), "_No screenshots changed._");
  });

  it("puts the biggest mover first", () => {
    const table = formatComparisonTable([
      { name: "small.png", kind: "changed", changedRatio: 0.01 },
      { name: "big.png", kind: "changed", changedRatio: 0.5 },
    ]);
    const names = [...table.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    assert.deepEqual(names, ["big.png", "small.png"]);
  });

  it("labels an image with no baseline instead of printing a percentage for it", () => {
    const table = formatComparisonTable([{ name: "new.png", kind: "new", changedRatio: null }]);
    assert.match(table, /\| `new\.png` \| new file \|/);
  });
});
