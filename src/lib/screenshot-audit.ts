/**
 * Deciding whether a freshly captured console screenshot can be trusted.
 *
 * The refresh workflow lands its own PR (see .github/workflows/refresh-screenshots.yml), so
 * something other than a human has to answer "is this screenshot actually right?". Three
 * checks, cheapest and most decisive first:
 *
 * 1. The page logged an error. scripts/capture-console.mjs already listens for `pageerror`,
 *    `console.error` and `requestfailed` on every scenario — it just threw the log away
 *    unless the scenario timed out. An uncaught exception fails the capture outright; the
 *    noisier two are recorded as warnings, because an aborted fetch or a missing optional
 *    asset should not wedge the refresh, and a run that goes red leaves the published
 *    screenshots stale just as surely as a bad one that merges.
 * 2. The frame is blank. A page can satisfy every DOM assertion and still photograph as a
 *    flat rectangle — a white flash mid-render, a solid error background. Nothing else
 *    catches that, and it needs no baseline: one colour covering almost the whole image is
 *    conclusive on its own.
 * 3. How much changed against the screenshot already committed. This one cannot tell a
 *    redesign from a disaster, so it does not fail anything — past the threshold it holds
 *    the PR for a human, which is the right answer to both.
 *
 * Only 1 and 2 can fail a capture. 3 decides whether the PR merges itself.
 *
 * Everything here is pure: buffers in, numbers and strings out, no I/O and no image
 * library, so `npm test` exercises it without a build. The scripts do the decoding (with
 * sharp, already a dependency) and hand the raw RGBA in.
 */

/**
 * A frame this flat is not a screenshot of anything. Real console pages carry a sidebar,
 * text and a chart or table; even the emptiest of them is nowhere near this uniform, and
 * the blank and solid-colour failures are at 100%.
 */
export const BLANK_FRAME_RATIO = 0.98;

/**
 * Past this much change against the committed screenshot, a human looks. A point release
 * that nudges a label moves well under a percent; a console redesign moves far more than
 * this and is exactly the case worth a pair of eyes.
 */
export const REVIEW_CHANGE_RATIO = 0.25;

/**
 * Per-channel slack when comparing two pixels. The captures are deterministic — animations
 * are frozen and the clock is paused before every shot — so this only absorbs the odd
 * rounding difference in a gradient or an antialiased glyph edge.
 */
export const PIXEL_TOLERANCE = 8;

export type ComparisonKind = "changed" | "new" | "resized";

export interface ScreenshotComparison {
  /** File name, e.g. `console-dashboard-dark.png`. */
  name: string;
  kind: ComparisonKind;
  /** Fraction of pixels that differ. Null when there is nothing to compare against. */
  changedRatio: number | null;
}

export interface CaptureWarning {
  /** Scenario label, e.g. `console-dashboard-dark`. */
  scenario: string;
  message: string;
}

/**
 * Page-log entries that say nothing about the screenshot. Anything else logged by the
 * console still holds the PR for a human, so each rule here is narrow: it names the exact
 * message, and for a network error the exact request, rather than a whole class of failure.
 *
 * - Playwright's clock shim (`page.clock.install`) is injected into every frame, including
 *   the sandboxed email preview iframe. That iframe has no `allow-scripts` on purpose, so
 *   Chrome logs the block. The message comes from the harness; the seeded email has no
 *   script in it.
 * - The console asks S3 for a bucket's lifecycle and website configuration on every bucket
 *   page. A bucket without one gets a 404 (`NoSuchLifecycleConfiguration`,
 *   `NoSuchWebsiteConfiguration`), which is what real S3 answers and which the console maps
 *   to "not configured". The page handles it, but Chrome logs any 404 before JS sees it.
 */
const SANDBOXED_SRCDOC_BLOCK = /^console\.error: Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/;
const RESOURCE_404 = /^console\.error: Failed to load resource: the server responded with a status of 404\b.*\[([^\]]*)\]$/;
const ABSENT_CONFIG_REQUEST = /[?&](?:lifecycle|website)(?:[=&]|$)/;

/**
 * Whether a page-log entry from scripts/capture-console.mjs is expected noise. An entry is
 * `console.error: <text>`, with ` [<url>]` appended when Chrome reported which resource
 * failed to load (Playwright's `message.location().url`).
 */
export function isExpectedPageLog(entry: string): boolean {
  if (SANDBOXED_SRCDOC_BLOCK.test(entry)) return true;

  const failedResource = RESOURCE_404.exec(entry);
  return failedResource != null && ABSENT_CONFIG_REQUEST.test(failedResource[1]);
}

/**
 * The fraction of the image taken by its single most common colour. 1 means every pixel is
 * identical; a real page lands far below the blank threshold.
 */
export function dominantColourRatio(rgba: Uint8Array | Buffer): number {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return 1;

  const counts = new Map<number, number>();
  let dominant = 0;

  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    const key = ((rgba[offset] << 24) | (rgba[offset + 1] << 16) | (rgba[offset + 2] << 8) | rgba[offset + 3]) >>> 0;
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (next > dominant) dominant = next;
  }

  return dominant / pixels;
}

export function isBlankFrame(rgba: Uint8Array | Buffer, threshold = BLANK_FRAME_RATIO): boolean {
  return dominantColourRatio(rgba) >= threshold;
}

/**
 * The fraction of pixels that differ between two same-sized RGBA buffers. Callers compare
 * dimensions first — two images of different sizes have no meaningful per-pixel answer, and
 * are reported as `resized` instead.
 */
export function changedPixelRatio(
  before: Uint8Array | Buffer,
  after: Uint8Array | Buffer,
  tolerance = PIXEL_TOLERANCE,
): number {
  if (before.length !== after.length) {
    throw new Error(`Cannot compare buffers of different lengths (${before.length} vs ${after.length}).`);
  }

  const pixels = Math.floor(before.length / 4);
  if (pixels === 0) return 0;

  let changed = 0;
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    if (
      Math.abs(before[offset] - after[offset]) > tolerance ||
      Math.abs(before[offset + 1] - after[offset + 1]) > tolerance ||
      Math.abs(before[offset + 2] - after[offset + 2]) > tolerance ||
      Math.abs(before[offset + 3] - after[offset + 3]) > tolerance
    ) {
      changed++;
    }
  }

  return changed / pixels;
}

export interface AuditVerdict {
  verdict: "auto" | "review";
  /** Why a human is needed. Empty when the verdict is `auto`. */
  reasons: string[];
}

export function auditVerdict(
  comparisons: readonly ScreenshotComparison[],
  warnings: readonly CaptureWarning[],
  threshold = REVIEW_CHANGE_RATIO,
): AuditVerdict {
  const reasons: string[] = [];

  for (const warning of warnings) {
    reasons.push(`\`${warning.scenario}\` logged: ${warning.message}`);
  }

  for (const comparison of comparisons) {
    if (comparison.kind === "new") {
      reasons.push(`\`${comparison.name}\` is new, so there is nothing to compare it against.`);
      continue;
    }
    if (comparison.kind === "resized") {
      reasons.push(`\`${comparison.name}\` changed dimensions.`);
      continue;
    }
    if (comparison.changedRatio != null && comparison.changedRatio >= threshold) {
      reasons.push(`\`${comparison.name}\` changed by ${formatPercent(comparison.changedRatio)}.`);
    }
  }

  return { verdict: reasons.length > 0 ? "review" : "auto", reasons };
}

export function formatPercent(ratio: number): string {
  if (ratio > 0 && ratio < 0.001) return "<0.1%";
  return `${(ratio * 100).toFixed(1)}%`;
}

/** The per-image table that goes in the PR body. */
export function formatComparisonTable(comparisons: readonly ScreenshotComparison[]): string {
  if (comparisons.length === 0) return "_No screenshots changed._";

  const rows = [...comparisons]
    .sort((a, b) => (b.changedRatio ?? Infinity) - (a.changedRatio ?? Infinity) || a.name.localeCompare(b.name))
    .map((comparison) => {
      const changed =
        comparison.kind === "new" ? "new file" : comparison.kind === "resized" ? "resized" : formatPercent(comparison.changedRatio ?? 0);
      return `| \`${comparison.name}\` | ${changed} |`;
    });

  return ["| Screenshot | Changed |", "| --- | --- |", ...rows].join("\n");
}
