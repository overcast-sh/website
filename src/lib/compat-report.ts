/**
 * compat-report — the public compatibility report, as the site reads it.
 *
 * Upstream, every Overcast release ships `compat-report.json` (written by
 * `go run ./cmd/compat --publish-report`, schema at compat/report.schema.json in
 * overcast-sh/overcast). It is one document per release: every compat test, every
 * suite's result for it, and for anything that did not pass, exactly one reason
 * code that says why and whose move it is. scripts/sync-overcast-content.ts copies
 * each release's report into src/generated/compat/.
 *
 * Everything here is pure (data in, data out) so `npm test` covers it with no build.
 * The pages under src/pages/compat/ and the explorer script both work from these
 * helpers, which is what keeps the static pages and the filtered view agreeing on
 * what a number means.
 */

export type Whose = "overcast" | "suite" | "sdk" | "environment" | "none";
export type ResultStatus = "pass" | "fail" | "skip" | "unimplemented" | "na";

export interface CompatIssue {
  number: number;
  url: string;
  title?: string;
  state?: string;
}

export interface CompatMismatch {
  op: string;
  params?: string;
  kind: string;
  path?: string;
  expected: string;
  actual: string;
  scenario: string;
  step: string;
}

export interface CompatResult {
  status: ResultStatus;
  reason?: string;
  durationMs?: number;
  error?: string;
  mismatch?: CompatMismatch;
  blockedBy?: string[];
  issue?: CompatIssue;
}

export interface CompatTest {
  name: string;
  op: string;
  depends?: string[];
  requires?: string[];
  results: Record<string, CompatResult>;
}

export interface CompatGroup {
  id: string;
  generated?: boolean;
  state?: string;
  scenario?: string;
  tests: CompatTest[];
}

export interface CompatGap {
  op: string;
  group: string;
  reason: string;
  code: string;
  detail: string;
  issue?: CompatIssue;
}

export interface CompatTotals {
  cells: number;
  pass: number;
  byReason: Record<string, number>;
  untested?: number;
}

export interface CompatService {
  id: string;
  totals: CompatTotals;
  groups: CompatGroup[];
  untested?: CompatGap[];
}

export interface CompatSuite {
  id: string;
  label: string;
  kind: "sdk" | "cli" | "iac";
  language: string;
  totals: CompatTotals;
}

export interface CompatReason {
  code: string;
  label: string;
  summary: string;
  whose: Whose;
}

export interface CompatReport {
  schema: number;
  version: string;
  commit?: string;
  generatedAt: string;
  runStartedAt?: string;
  runFinishedAt?: string;
  issueRepo: string;
  reasons: CompatReason[];
  suites: CompatSuite[];
  totals: CompatTotals;
  services: CompatService[];
}

/** One entry of src/generated/compat/index.json, newest release first. */
export interface CompatReportIndexEntry {
  tag: string;
  publishedAt: string | null;
  prerelease: boolean;
  /** Where the report came from: a release asset, or a local file in development. */
  source: "release" | "local";
}

/** The schema version this site renders. A report with any other is skipped by the sync. */
export const SUPPORTED_SCHEMA = 1;

// ── Owners ────────────────────────────────────────────────────────────────────

/** The reader-facing heading for each owner, in the order the overview lists them. */
export const WHOSE_ORDER: readonly Whose[] = ["overcast", "suite", "sdk", "environment", "none"];

export const WHOSE_LABELS: Record<Whose, { title: string; blurb: string }> = {
  overcast: {
    title: "Overcast gaps",
    blurb: "Results Overcast itself has to fix: behaviour that differs from AWS, operations with no emulation yet, and the steps those block.",
  },
  suite: {
    title: "Test coverage gaps",
    blurb: "Tests that have not been written or settled for a language yet. Overcast may well handle these calls; nothing has checked.",
  },
  sdk: {
    title: "SDK limits",
    blurb: "Operations an SDK or the CLI has no API for, so there is nothing to call.",
  },
  environment: {
    title: "Environment",
    blurb: "Tests that need Docker, SMTP or network access the release run does not provide.",
  },
  none: {
    title: "Not tested",
    blurb: "Operations with no test at all. The generator declined to write one and recorded why.",
  },
};

export type Tone = "success" | "warning" | "danger" | "muted" | "accent";

/** Chip tone per owner: Overcast's gaps are the ones that bear on "will my call work". */
export const WHOSE_TONE: Record<Whose, Tone> = {
  overcast: "danger",
  suite: "muted",
  sdk: "muted",
  environment: "muted",
  none: "warning",
};

/** Per-reason tone, finer than the owner's: a 501 is a known gap, a mismatch is a bug. */
export function reasonTone(code: string | undefined, reasons: readonly CompatReason[]): Tone {
  if (!code) return "success";
  if (code === "behaviour-mismatch") return "danger";
  if (code === "not-emulated" || code === "quarantined-flaky" || code === "dependency-failed") return "warning";
  const reason = reasons.find((r) => r.code === code);
  return reason?.whose === "overcast" ? "warning" : "muted";
}

export function reasonByCode(report: Pick<CompatReport, "reasons">): Map<string, CompatReason> {
  return new Map(report.reasons.map((reason) => [reason.code, reason]));
}

/** The owner of a reason code. Unknown codes are treated as Overcast's, the cautious reading. */
export function whoseOf(code: string, reasons: ReadonlyMap<string, CompatReason>): Whose {
  return reasons.get(code)?.whose ?? "overcast";
}

// ── Services ──────────────────────────────────────────────────────────────────

/**
 * Compat service ids that are spelt differently from the support matrix's (and so from the
 * service catalog and the docs). Everything else matches 1:1.
 */
const SUPPORT_ALIASES: Record<string, string> = {
  "elastic-load-balancing": "elbv2",
};

/** Names for compat services the support matrix has no row for. */
const EXTRA_NAMES: Record<string, string> = {
  cdk: "CDK stacks",
  servicediscovery: "Cloud Map",
  batch: "Batch",
  "elastic-load-balancing": "ELBv2",
};

/** The support matrix's service id for a compat service id. */
export function supportServiceId(compatId: string): string {
  return SUPPORT_ALIASES[compatId] ?? compatId;
}

export interface ServiceNaming {
  /** Display names by support-matrix service id, from service-support.json. */
  displayNames: ReadonlyMap<string, string>;
  /** Doc slugs by support-matrix service id. A service with no doc has no entry. */
  docSlugs: ReadonlyMap<string, string>;
}

export function serviceDisplayName(compatId: string, naming: ServiceNaming): string {
  return naming.displayNames.get(supportServiceId(compatId)) ?? EXTRA_NAMES[compatId] ?? compatId;
}

export function serviceDocPath(compatId: string, naming: ServiceNaming): string | null {
  const slug = naming.docSlugs.get(supportServiceId(compatId));
  return slug ? `/docs/services/${slug}/` : null;
}

/** A URL-safe anchor for one test row, stable across releases. */
export function testAnchor(group: string, test: string): string {
  return `${group}--${test}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

// ── Numbers ───────────────────────────────────────────────────────────────────

/**
 * The cells that measure Overcast: passes plus Overcast's own gaps. A test nobody has
 * written, or one an SDK cannot express, says nothing about the emulator, so it stays out
 * of the rate. A 501 does count against it, unlike in the suites' own pass rate: "will this
 * call work against Overcast" is the question a reader brings here, and for a 501 it won't.
 */
export function measured(totals: CompatTotals, reasons: ReadonlyMap<string, CompatReason>): { pass: number; ran: number } {
  let gaps = 0;
  for (const [code, count] of Object.entries(totals.byReason)) {
    if (countsAgainst(code, reasons)) gaps += count;
  }
  return { pass: totals.pass, ran: totals.pass + gaps };
}

/**
 * Reasons that are Overcast's but have no result of their own. A test blocked by an earlier
 * step never ran: counting it would charge the one failure that blocked it once per dependent
 * test. It is listed with Overcast's gaps, and left out of the rate and the headline count.
 */
export const UNMEASURED_REASONS: ReadonlySet<string> = new Set(["dependency-failed"]);

/** Whether a reason counts against Overcast's pass rate. */
export function countsAgainst(code: string, reasons: ReadonlyMap<string, CompatReason>): boolean {
  return whoseOf(code, reasons) === "overcast" && !UNMEASURED_REASONS.has(code);
}

export function percent(part: number, whole: number): number {
  return whole ? Math.floor((part / whole) * 1000) / 10 : 0;
}

/** Totals for one owner: every reason it owns, summed. */
export function countByWhose(totals: CompatTotals, reasons: ReadonlyMap<string, CompatReason>): Record<Whose, number> {
  const out: Record<Whose, number> = { overcast: 0, suite: 0, sdk: 0, environment: 0, none: totals.untested ?? 0 };
  for (const [code, count] of Object.entries(totals.byReason)) out[whoseOf(code, reasons)] += count;
  return out;
}

export interface MatrixCell {
  suite: string;
  pass: number;
  ran: number;
  /** Every cell for this service and suite, whatever its reason. */
  cells: number;
  /** Counts by reason code, for the cell's tooltip and its screen-reader text. */
  byReason: Record<string, number>;
}

/** One service's row of the service × suite matrix. */
export function matrixRow(service: CompatService, suites: readonly CompatSuite[], reasons: ReadonlyMap<string, CompatReason>): MatrixCell[] {
  return suites.map((suite) => {
    const cell: MatrixCell = { suite: suite.id, pass: 0, ran: 0, cells: 0, byReason: {} };
    for (const group of service.groups) {
      for (const test of group.tests) {
        const result = test.results[suite.id];
        if (!result) continue;
        cell.cells += 1;
        if (!result.reason) {
          cell.pass += 1;
          cell.ran += 1;
          continue;
        }
        cell.byReason[result.reason] = (cell.byReason[result.reason] ?? 0) + 1;
        if (countsAgainst(result.reason, reasons)) cell.ran += 1;
      }
    }
    return cell;
  });
}

/** A service's pass/ran across the given suites: the sum of its matrix row. */
export function serviceMeasured(service: CompatService, suites: readonly CompatSuite[], reasons: ReadonlyMap<string, CompatReason>): { pass: number; ran: number } {
  return matrixRow(service, suites, reasons).reduce((sum, cell) => ({ pass: sum.pass + cell.pass, ran: sum.ran + cell.ran }), { pass: 0, ran: 0 });
}

/** Tone for a pass rate: all green, mostly there, or a real gap. No results at all is muted. */
export function rateTone(pass: number, ran: number): Tone {
  if (ran === 0) return "muted";
  if (pass === ran) return "success";
  return pass / ran >= 0.8 ? "warning" : "danger";
}

// ── Operations ────────────────────────────────────────────────────────────────

export interface OperationSummary {
  service: string;
  op: string;
  /** At least one suite passed a test that calls it. */
  verified: boolean;
  /** At least one Overcast-owned gap on a test that calls it. */
  failing: boolean;
}

/** Per-operation rollup, for the headline "operations verified" number. */
export function operationSummaries(report: CompatReport): OperationSummary[] {
  const reasons = reasonByCode(report);
  const byKey = new Map<string, OperationSummary>();
  for (const service of report.services) {
    for (const group of service.groups) {
      for (const test of group.tests) {
        const key = `${service.id}/${test.op}`;
        const summary = byKey.get(key) ?? { service: service.id, op: test.op, verified: false, failing: false };
        for (const result of Object.values(test.results)) {
          if (!result.reason) summary.verified = true;
          else if (countsAgainst(result.reason, reasons)) summary.failing = true;
        }
        byKey.set(key, summary);
      }
    }
  }
  return [...byKey.values()];
}

// ── Release-over-release ─────────────────────────────────────────────────────

export interface CellChange {
  service: string;
  group: string;
  test: string;
  op: string;
  suite: string;
  /** Reason code before, "" for a pass, null when the cell did not exist. */
  from: string | null;
  to: string | null;
}

function cellMap(report: CompatReport): Map<string, { service: string; group: string; test: CompatTest; suite: string; reason: string }> {
  const out = new Map();
  for (const service of report.services) {
    for (const group of service.groups) {
      for (const test of group.tests) {
        for (const [suite, result] of Object.entries(test.results)) {
          out.set(`${service.id}/${group.id}/${test.name}@${suite}`, { service: service.id, group: group.id, test, suite, reason: result.reason ?? "" });
        }
      }
    }
  }
  return out;
}

/**
 * Every cell whose outcome moved between two releases: newly passing, newly failing, or
 * changed from one reason to another. Cells that appear or disappear (a test added or
 * retired) are included with a null side, so a caller can decide whether they count.
 */
export function diffReports(previous: CompatReport, current: CompatReport): CellChange[] {
  const before = cellMap(previous);
  const after = cellMap(current);
  const changes: CellChange[] = [];
  for (const [key, cell] of after) {
    const old = before.get(key);
    const from = old ? old.reason : null;
    if (from === cell.reason) continue;
    changes.push({ service: cell.service, group: cell.group, test: cell.test.name, op: cell.test.op, suite: cell.suite, from, to: cell.reason });
  }
  for (const [key, cell] of before) {
    if (after.has(key)) continue;
    changes.push({ service: cell.service, group: cell.group, test: cell.test.name, op: cell.test.op, suite: cell.suite, from: cell.reason, to: null });
  }
  return changes;
}

/** A change that made a previously-running cell pass. */
export const isFixed = (change: CellChange): boolean => change.to === "" && change.from !== null && change.from !== "";
/** A change that turned a passing cell into anything else. */
export const isRegressed = (change: CellChange): boolean => change.from === "" && change.to !== null && change.to !== "";

// ── The explorer's index ─────────────────────────────────────────────────────

/**
 * The compact form the explorer fetches: one row per test, one slot per suite. Strings that
 * repeat (services, groups, reasons, suites) are dictionary-encoded, so ~1,200 tests across
 * eight suites come to a small fraction of the full report.
 *
 * A cell is a reason index, -1 for a pass, or null when the suite does not run the test.
 * Errors are trimmed: the explorer shows enough to recognise the failure and links to the
 * service page for the whole message.
 */
export interface ExplorerIndex {
  version: string;
  /** owner/repo that issue numbers refer to. */
  issueRepo: string;
  suites: { id: string; label: string }[];
  reasons: CompatReason[];
  services: { id: string; name: string }[];
  groups: string[];
  /** [serviceIdx, groupIdx, test, op ("" when equal to test), cells, details] */
  rows: ExplorerRow[];
  /** [serviceIdx, op, gap code, detail, issue number or 0] */
  untested: [number, string, string, string, number][];
  /** "service/group/test@suite" of every cell whose outcome moved since the previous release. */
  changed?: { fixed: string[]; regressed: string[]; previous: string };
}

export type ExplorerCell = number | null;
/** Per-suite detail, keyed by suite index: [error snippet, issue number or 0, blocked by]. */
export type ExplorerDetail = Record<number, [string, number, string]>;
export type ExplorerRow = [number, number, string, string, ExplorerCell[], ExplorerDetail];

export const EXPLORER_ERROR_LIMIT = 240;

export function trimError(error: string | undefined, limit = EXPLORER_ERROR_LIMIT): string {
  if (!error) return "";
  const flat = error.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export function buildExplorerIndex(report: CompatReport, naming: ServiceNaming, previous?: CompatReport): ExplorerIndex {
  const reasonIndex = new Map(report.reasons.map((reason, i) => [reason.code, i]));
  const suiteIndex = new Map(report.suites.map((suite, i) => [suite.id, i]));
  const groups: string[] = [];
  const groupIndex = new Map<string, number>();
  const rows: ExplorerRow[] = [];
  const untested: ExplorerIndex["untested"] = [];

  report.services.forEach((service, serviceIdx) => {
    for (const group of service.groups) {
      let g = groupIndex.get(group.id);
      if (g === undefined) {
        g = groups.push(group.id) - 1;
        groupIndex.set(group.id, g);
      }
      for (const test of group.tests) {
        const cells: ExplorerCell[] = report.suites.map(() => null);
        const details: ExplorerDetail = {};
        for (const [suiteId, result] of Object.entries(test.results)) {
          const s = suiteIndex.get(suiteId);
          if (s === undefined) continue;
          if (!result.reason) {
            cells[s] = -1;
            continue;
          }
          // An unknown code would index nothing; it is appended so it still renders.
          let r = reasonIndex.get(result.reason);
          if (r === undefined) {
            r = reasonIndex.size;
            reasonIndex.set(result.reason, r);
          }
          cells[s] = r;
          const error = trimError(result.error);
          const issue = result.issue?.number ?? 0;
          const blocked = result.blockedBy?.join(", ") ?? "";
          if (error || issue || blocked) details[s] = [error, issue, blocked];
        }
        rows.push([serviceIdx, g, test.name, test.op === test.name ? "" : test.op, cells, details]);
      }
    }
    for (const gap of service.untested ?? []) {
      untested.push([serviceIdx, gap.op, gap.code, gap.detail, gap.issue?.number ?? 0]);
    }
  });

  const reasons = [...report.reasons];
  for (const [code, i] of reasonIndex) {
    if (i >= report.reasons.length) reasons[i] = { code, label: code, summary: "", whose: "overcast" };
  }

  const index: ExplorerIndex = {
    version: report.version,
    issueRepo: report.issueRepo,
    suites: report.suites.map((suite) => ({ id: suite.id, label: suite.label })),
    reasons,
    services: report.services.map((service) => ({ id: service.id, name: serviceDisplayName(service.id, naming) })),
    groups,
    rows,
    untested,
  };
  if (previous) {
    const changes = diffReports(previous, report);
    const key = (c: CellChange) => `${c.service}/${c.group}/${c.test}@${c.suite}`;
    index.changed = {
      previous: previous.version,
      fixed: changes.filter(isFixed).map(key),
      regressed: changes.filter(isRegressed).map(key),
    };
  }
  return index;
}

// ── Presentation ─────────────────────────────────────────────────────────────

/** Column headings for the suites: a matrix of eight full SDK names does not fit a phone. */
export const SUITE_SHORT: Record<string, string> = {
  "node-js-sdk": "JS",
  "python-sdk": "Python",
  "go-sdk": "Go",
  cli: "CLI",
  cdk: "CDK",
  "java-sdk": "Java",
  "dotnet-sdk": ".NET",
  "rust-sdk": "Rust",
};

export const suiteShort = (id: string): string => SUITE_SHORT[id] ?? id;

/** The word in a matrix cell. The full label and summary come from the report itself. */
export const REASON_SHORT: Record<string, string> = {
  "behaviour-mismatch": "Differs",
  "not-emulated": "501",
  "quarantined-flaky": "Flaky",
  "dependency-failed": "Blocked",
  "suite-not-written": "No test",
  candidate: "Soaking",
  "not-reported": "Missing",
  "sdk-lacks-api": "N/A",
  "needs-environment": "Env",
  "other-skip": "Skipped",
  untested: "Untested",
};

export const reasonShort = (code: string | undefined): string => (code ? (REASON_SHORT[code] ?? code) : "Pass");

/** Symbols in CompatIconSprite, one per reason that has its own glyph. */
export const COMPAT_ICON_KEYS = [
  "pass",
  "behaviour-mismatch",
  "not-emulated",
  "quarantined-flaky",
  "dependency-failed",
  "suite-not-written",
  "candidate",
  "sdk-lacks-api",
  "needs-environment",
  "other",
] as const;

/** The sprite symbol for a result: its reason's own glyph, or a neutral one. */
export function compatIconKey(code: string | undefined): (typeof COMPAT_ICON_KEYS)[number] {
  if (!code) return "pass";
  return (COMPAT_ICON_KEYS as readonly string[]).includes(code) ? (code as (typeof COMPAT_ICON_KEYS)[number]) : "other";
}

/** Every reason that has at least one cell, in the report's own order. */
export function reasonsInUse(report: CompatReport): CompatReason[] {
  return report.reasons.filter((reason) =>
    reason.code === "untested" ? (report.totals.untested ?? 0) > 0 : (report.totals.byReason[reason.code] ?? 0) > 0,
  );
}

/** The count for one reason, untested included. */
export function reasonCount(report: CompatReport, code: string): number {
  return code === "untested" ? (report.totals.untested ?? 0) : (report.totals.byReason[code] ?? 0);
}

/** A short commit for display. */
export const shortCommit = (sha: string | undefined): string => (sha ? sha.slice(0, 9) : "");

export interface ResultGroup {
  reason: string;
  entries: { suite: { id: string; label: string }; result: CompatResult }[];
}

/**
 * A test's non-passing results, grouped so that clients sharing an outcome read once: same
 * reason, same parsed evidence, same tracking issue. Messages may still differ (every SDK words
 * a 501 its own way); the detail view lists them together. Groups keep suite order, and
 * Overcast's own gaps come first.
 */
export function groupResults(test: CompatTest, suites: readonly { id: string; label: string }[], reasons: ReadonlyMap<string, CompatReason>): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  for (const suite of suites) {
    const result = test.results[suite.id];
    if (!result?.reason) continue;
    const m = result.mismatch;
    const key = [result.reason, result.issue?.number ?? 0, m ? `${m.kind}|${m.path}|${m.expected}|${m.actual}` : "", (result.blockedBy ?? []).join(",")].join("|");
    const group = groups.get(key) ?? { reason: result.reason, entries: [] };
    group.entries.push({ suite: { id: suite.id, label: suite.label }, result });
    groups.set(key, group);
  }
  const rank = (code: string) => (whoseOf(code, reasons) === "overcast" ? 0 : 1);
  return [...groups.values()].sort((a, b) => rank(a.reason) - rank(b.reason));
}
