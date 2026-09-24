/**
 * compat-filter — the explorer's filtering, with no DOM in it.
 *
 * /compat/explore/ fetches a release's ExplorerIndex and filters it as the reader types.
 * Everything that decides *what matches* lives here so `npm test` can pin it: the URL
 * round-trip that makes every view a link, token matching, facet counts, and ranking.
 * The page script only renders what this returns.
 *
 * The unit of filtering is the cell (one test, one suite). A test row is shown when at
 * least one of its cells passes every facet, and the facet counts are cells too, so the
 * numbers on the buttons always add up to the results they would leave.
 */
import type { ExplorerIndex, ExplorerRow, Whose } from "./compat-report.ts";

/** An outcome is a reason code, or one of these two. */
export const PASS = "pass";
export const UNTESTED = "untested";

export type IssueFilter = "any" | "linked" | "unlinked";
export type ChangeFilter = "any" | "fixed" | "regressed";

export interface FilterState {
  q: string;
  /** Empty means every value; otherwise the selected ones, OR-ed together. */
  outcomes: string[];
  whose: Whose[];
  suites: string[];
  issue: IssueFilter;
  changed: ChangeFilter;
}

export const EMPTY_STATE: FilterState = { q: "", outcomes: [], whose: [], suites: [], issue: "any", changed: "any" };

const WHOSE_VALUES: readonly Whose[] = ["overcast", "suite", "sdk", "environment", "none"];
const ISSUE_VALUES: readonly IssueFilter[] = ["any", "linked", "unlinked"];
const CHANGE_VALUES: readonly ChangeFilter[] = ["any", "fixed", "regressed"];

const list = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Reads the filter from a query string. Unknown values are dropped, never thrown on. */
export function parseState(search: string): FilterState {
  const params = new URLSearchParams(search);
  const issue = params.get("issue") as IssueFilter | null;
  const changed = params.get("changed") as ChangeFilter | null;
  return {
    q: params.get("q") ?? "",
    outcomes: [...new Set(list(params.get("outcome")))],
    whose: [...new Set(list(params.get("whose")))].filter((w): w is Whose => WHOSE_VALUES.includes(w as Whose)),
    suites: [...new Set(list(params.get("suite")))],
    issue: issue && ISSUE_VALUES.includes(issue) ? issue : "any",
    changed: changed && CHANGE_VALUES.includes(changed) ? changed : "any",
  };
}

/**
 * Writes the filter back as query parameters, leaving out every default so an unfiltered
 * view is the bare URL. `release` is carried through untouched: it picks the data, not the
 * filter.
 */
export function serializeState(state: FilterState, release?: string): string {
  const params = new URLSearchParams();
  if (release) params.set("release", release);
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.outcomes.length) params.set("outcome", state.outcomes.join(","));
  if (state.whose.length) params.set("whose", state.whose.join(","));
  if (state.suites.length) params.set("suite", state.suites.join(","));
  if (state.issue !== "any") params.set("issue", state.issue);
  if (state.changed !== "any") params.set("changed", state.changed);
  const out = params.toString();
  return out ? `?${out}` : "";
}

export function isFiltered(state: FilterState): boolean {
  return Boolean(state.q.trim()) || state.outcomes.length > 0 || state.whose.length > 0 || state.suites.length > 0 || state.issue !== "any" || state.changed !== "any";
}

// ── Preparation ──────────────────────────────────────────────────────────────

/** "CloudWatch Logs", "cloudwatch-logs" and "cloudwatchlogs" all find the same thing. */
export const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9#]/g, "");

export interface PreparedRow {
  row: ExplorerRow;
  service: string;
  serviceName: string;
  group: string;
  test: string;
  op: string;
  /** Everything a word may match in, lower-cased and squashed. */
  haystack: string;
  /** Cell keys for the changed-since-last-release facet, one per suite (or null). */
  keys: string[];
}

export interface PreparedUntested {
  service: string;
  serviceName: string;
  op: string;
  code: string;
  detail: string;
  issue: number;
  haystack: string;
}

export interface PreparedIndex {
  index: ExplorerIndex;
  rows: PreparedRow[];
  untested: PreparedUntested[];
  fixed: Set<string>;
  regressed: Set<string>;
}

export function prepare(index: ExplorerIndex): PreparedIndex {
  const rows = index.rows.map((row): PreparedRow => {
    const [s, g, test, opOrEmpty, , details] = row;
    const service = index.services[s];
    const group = index.groups[g];
    const op = opOrEmpty || test;
    const extras = Object.values(details).flatMap(([error, issue, blocked]) => [error, issue ? `#${issue}` : "", blocked]);
    const haystack = [service.id, service.name, group, test, op, ...extras].map(squash).join(" ");
    const keys = index.suites.map((suite) => `${service.id}/${group}/${test}@${suite.id}`);
    return { row, service: service.id, serviceName: service.name, group, test, op, haystack, keys };
  });
  const untested = index.untested.map(([s, op, code, detail, issue]): PreparedUntested => {
    const service = index.services[s];
    return {
      service: service.id,
      serviceName: service.name,
      op,
      code,
      detail,
      issue,
      haystack: [service.id, service.name, op, code, detail, issue ? `#${issue}` : ""].map(squash).join(" "),
    };
  });
  return { index, rows, untested, fixed: new Set(index.changed?.fixed ?? []), regressed: new Set(index.changed?.regressed ?? []) };
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export interface FacetCounts {
  outcome: Record<string, number>;
  whose: Record<string, number>;
  suite: Record<string, number>;
  issue: Record<IssueFilter, number>;
  changed: Record<ChangeFilter, number>;
}

export interface MatchedRow {
  prepared: PreparedRow;
  /** Per suite: does this cell pass every facet. Non-matching cells render dimmed. */
  mask: boolean[];
  rank: number;
}

export interface Evaluation {
  rows: MatchedRow[];
  untested: PreparedUntested[];
  /** Matching cells, plus matching untested operations. */
  total: number;
  counts: FacetCounts;
}

/** The words of a query, squashed. Empty words (pure punctuation) are dropped. */
export function queryWords(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .map(squash)
    .filter(Boolean);
}

function textRank(words: string[], p: { op: string; test?: string; service: string }): number {
  // Exact operation or test name first, then a name that starts with the first word, then
  // everything else in report order. Only the first word ranks; the rest only filter.
  if (!words.length) return 0;
  const first = words[0];
  const names = [squash(p.op), squash(p.test ?? p.op)];
  if (names.includes(first)) return 3;
  if (names.some((name) => name.startsWith(first))) return 2;
  if (squash(p.service) === first) return 1;
  return 0;
}

type Cell = { outcome: string; whose: Whose; suite: string; issue: boolean; key: string };

/**
 * Filters the prepared index. For each facet, its own counts are computed with every
 * *other* facet applied, which is what makes a count say "pressing this would leave N".
 */
export function evaluate(prepared: PreparedIndex, state: FilterState): Evaluation {
  const { index } = prepared;
  const words = queryWords(state.q);
  const outcomeOf = (cell: number) => (cell === -1 ? PASS : index.reasons[cell]?.code ?? "unknown");
  const whoseOfCell = (cell: number): Whose => (cell === -1 ? "overcast" : index.reasons[cell]?.whose ?? "overcast");

  const outcomeOk = (c: Pick<Cell, "outcome">) => !state.outcomes.length || state.outcomes.includes(c.outcome);
  // A pass belongs to nobody: the owner facet narrows to gaps, so a pass never survives it.
  const whoseOk = (c: Pick<Cell, "outcome" | "whose">) => !state.whose.length || (c.outcome !== PASS && state.whose.includes(c.whose));
  const suiteOk = (c: Pick<Cell, "suite">) => !state.suites.length || state.suites.includes(c.suite);
  const issueOk = (c: Pick<Cell, "issue">) => state.issue === "any" || (state.issue === "linked") === c.issue;
  const changedOk = (c: Pick<Cell, "key">) =>
    state.changed === "any" || (state.changed === "fixed" ? prepared.fixed.has(c.key) : prepared.regressed.has(c.key));
  const checks = { outcome: outcomeOk, whose: whoseOk, suite: suiteOk, issue: issueOk, changed: changedOk };
  type Facet = keyof typeof checks;
  const passesExcept = (c: Cell, skip: Facet | null) =>
    (Object.keys(checks) as Facet[]).every((facet) => facet === skip || checks[facet](c as never));

  const counts: FacetCounts = {
    outcome: {},
    whose: {},
    suite: {},
    issue: { any: 0, linked: 0, unlinked: 0 },
    changed: { any: 0, fixed: 0, regressed: 0 },
  };
  const bump = (record: Record<string, number>, key: string) => (record[key] = (record[key] ?? 0) + 1);

  const rows: MatchedRow[] = [];
  let total = 0;
  for (const p of prepared.rows) {
    if (!words.every((word) => p.haystack.includes(word))) continue;
    const [, , , , cells, details] = p.row;
    const mask = cells.map(() => false);
    cells.forEach((value, s) => {
      if (value === null) return;
      const cell: Cell = {
        outcome: outcomeOf(value),
        whose: whoseOfCell(value),
        suite: index.suites[s].id,
        issue: Boolean(details[s]?.[1]),
        key: p.keys[s],
      };
      if (passesExcept(cell, "outcome")) bump(counts.outcome, cell.outcome);
      if (cell.outcome !== PASS && passesExcept(cell, "whose")) bump(counts.whose, cell.whose);
      if (passesExcept(cell, "suite")) bump(counts.suite, cell.suite);
      if (passesExcept(cell, "issue")) {
        counts.issue.any += 1;
        bump(counts.issue, cell.issue ? "linked" : "unlinked");
      }
      if (passesExcept(cell, "changed")) {
        counts.changed.any += 1;
        if (prepared.fixed.has(cell.key)) counts.changed.fixed += 1;
        if (prepared.regressed.has(cell.key)) counts.changed.regressed += 1;
      }
      if (passesExcept(cell, null)) {
        mask[s] = true;
        total += 1;
      }
    });
    if (mask.some(Boolean)) rows.push({ prepared: p, mask, rank: textRank(words, p) });
  }

  // Untested operations have no suite and no result. They join the outcome and owner
  // facets as "untested" / "none", and drop out as soon as a suite, issue link or change
  // is asked for, since none of those can describe them.
  const untested: PreparedUntested[] = [];
  const noSuiteFacets = !state.suites.length && state.changed === "any";
  for (const u of prepared.untested) {
    if (!words.every((word) => u.haystack.includes(word))) continue;
    const linked = u.issue > 0;
    const cell = { outcome: UNTESTED, whose: "none" as Whose, issue: linked };
    const issueMatch = state.issue === "any" || (state.issue === "linked") === linked;
    if (noSuiteFacets && issueMatch && whoseOk(cell)) bump(counts.outcome, UNTESTED);
    if (noSuiteFacets && issueMatch && outcomeOk(cell)) bump(counts.whose, "none");
    if (noSuiteFacets && outcomeOk(cell) && whoseOk(cell)) {
      counts.issue.any += 1;
      bump(counts.issue, linked ? "linked" : "unlinked");
    }
    if (noSuiteFacets && issueMatch && outcomeOk(cell) && whoseOk(cell)) {
      untested.push(u);
      total += 1;
    }
  }

  rows.sort((a, b) => b.rank - a.rank);
  untested.sort((a, b) => textRank(words, { op: b.op, service: b.service }) - textRank(words, { op: a.op, service: a.service }));
  return { rows, untested, total, counts };
}
