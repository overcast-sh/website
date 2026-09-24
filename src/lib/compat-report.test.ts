// Unit tests for the compatibility report helpers and the explorer's filter. Run with
// `npm test`. Both modules are pure, so the fixture below is all either needs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExplorerIndex,
  countByWhose,
  diffReports,
  groupResults,
  isFixed,
  isRegressed,
  matrixRow,
  measured,
  operationSummaries,
  rateTone,
  reasonByCode,
  serviceDisplayName,
  serviceDocPath,
  testAnchor,
  trimError,
  type CompatReport,
  type ServiceNaming,
} from "./compat-report.ts";
import { EMPTY_STATE, evaluate, isFiltered, parseState, prepare, serializeState, type FilterState } from "./compat-filter.ts";
import { issueMarkerTargets, newIssueUrl } from "./compat-issue-link.ts";
import { compatOverviewMarkdown, compatReasonMarkdown, compatServiceMarkdown } from "./site-markdown.ts";

const REASONS: CompatReport["reasons"] = [
  { code: "behaviour-mismatch", label: "Behaves differently from AWS", summary: "…", whose: "overcast" },
  { code: "not-emulated", label: "Not emulated yet", summary: "…", whose: "overcast" },
  { code: "dependency-failed", label: "Blocked by an earlier step", summary: "…", whose: "overcast" },
  { code: "suite-not-written", label: "Test not written for this SDK", summary: "…", whose: "suite" },
  { code: "sdk-lacks-api", label: "Not in this SDK", summary: "…", whose: "sdk" },
  { code: "untested", label: "Not tested", summary: "…", whose: "none" },
];

function report(version: string, overrides: Partial<Record<string, string>> = {}): CompatReport {
  // go-sdk and rust-sdk over two S3 tests and one ELB test. `overrides` sets a cell's reason
  // by "test@suite" ("" is a pass), so a second release can move individual cells.
  const cell = (test: string, suite: string, fallback: string) => {
    const reason = overrides[`${test}@${suite}`] ?? fallback;
    return reason ? { status: "skip" as const, reason, error: `${reason} for ${test}` } : { status: "pass" as const };
  };
  return {
    schema: 1,
    version,
    generatedAt: "2026-09-24T00:00:00Z",
    issueRepo: "overcast-sh/overcast",
    reasons: REASONS,
    suites: [
      { id: "go-sdk", label: "AWS SDK for Go v2", kind: "sdk", language: "Go", totals: { cells: 3, pass: 2, byReason: {} } },
      { id: "rust-sdk", label: "AWS SDK for Rust", kind: "sdk", language: "Rust", totals: { cells: 3, pass: 1, byReason: {} } },
    ],
    totals: { cells: 6, pass: 3, byReason: { "not-emulated": 1, "suite-not-written": 2 }, untested: 1 },
    services: [
      {
        id: "s3",
        totals: { cells: 4, pass: 2, byReason: {} },
        groups: [
          {
            id: "s3-crud",
            tests: [
              { name: "CreateBucket", op: "CreateBucket", results: { "go-sdk": cell("CreateBucket", "go-sdk", ""), "rust-sdk": cell("CreateBucket", "rust-sdk", "") } },
              {
                name: "PutObjectTagged",
                op: "PutObject",
                results: {
                  "go-sdk": cell("PutObjectTagged", "go-sdk", "not-emulated"),
                  "rust-sdk": { ...cell("PutObjectTagged", "rust-sdk", "suite-not-written"), issue: { number: 42, url: "https://github.com/o/r/issues/42" } },
                },
              },
            ],
          },
        ],
      },
      {
        id: "elastic-load-balancing",
        totals: { cells: 2, pass: 1, byReason: {} },
        groups: [
          {
            id: "elb-crud",
            tests: [
              { name: "CreateLoadBalancer", op: "CreateLoadBalancer", results: { "go-sdk": cell("CreateLoadBalancer", "go-sdk", ""), "rust-sdk": cell("CreateLoadBalancer", "rust-sdk", "suite-not-written") } },
            ],
          },
        ],
        untested: [{ op: "DeleteLoadBalancer", group: "elb-crud", reason: "never-probe", code: "never-probe", detail: "destructive" }],
      },
    ],
  };
}

const naming: ServiceNaming = {
  displayNames: new Map([
    ["s3", "S3"],
    ["elbv2", "ELBv2"],
  ]),
  docSlugs: new Map([
    ["s3", "s3"],
    ["elbv2", "elb"],
  ]),
};

describe("compat-report", () => {
  it("names services through the support matrix, aliases included", () => {
    assert.equal(serviceDisplayName("s3", naming), "S3");
    assert.equal(serviceDisplayName("elastic-load-balancing", naming), "ELBv2");
    assert.equal(serviceDocPath("elastic-load-balancing", naming), "/docs/services/elb/");
    assert.equal(serviceDisplayName("servicediscovery", naming), "Cloud Map");
    assert.equal(serviceDocPath("cdk", naming), null);
    assert.equal(serviceDisplayName("brand-new", naming), "brand-new");
  });

  it("builds stable anchors", () => {
    assert.equal(testAnchor("s3-crud", "PutObjectTagged"), "s3-crud--putobjecttagged");
    assert.equal(testAnchor("g", "Weird Name/1"), "g--weird-name-1");
  });

  it("measures only the cells that say something about Overcast", () => {
    const r = report("v1");
    const reasons = reasonByCode(r);
    assert.deepEqual(measured(r.totals, reasons), { pass: 3, ran: 4 });
    // A blocked test never ran, so it is not charged a second time.
    assert.deepEqual(measured({ ...r.totals, byReason: { ...r.totals.byReason, "dependency-failed": 5 } }, reasons), { pass: 3, ran: 4 });
    assert.deepEqual(countByWhose(r.totals, reasons), { overcast: 1, suite: 2, sdk: 0, environment: 0, none: 1 });
  });

  it("rolls a service up per suite", () => {
    const r = report("v1");
    const [go, rust] = matrixRow(r.services[0], r.suites, reasonByCode(r));
    assert.deepEqual(go, { suite: "go-sdk", pass: 1, ran: 2, cells: 2, byReason: { "not-emulated": 1 } });
    assert.deepEqual(rust, { suite: "rust-sdk", pass: 1, ran: 1, cells: 2, byReason: { "suite-not-written": 1 } });
    assert.equal(rateTone(go.pass, go.ran), "danger");
    assert.equal(rateTone(rust.pass, rust.ran), "success");
    assert.equal(rateTone(0, 0), "muted");
  });

  it("counts an operation verified when any suite passes it", () => {
    const ops = operationSummaries(report("v1"));
    const put = ops.find((op) => op.op === "PutObject");
    assert.deepEqual(put, { service: "s3", op: "PutObject", verified: false, failing: true });
    assert.equal(ops.filter((op) => op.verified).length, 2);
  });

  it("diffs two releases cell by cell", () => {
    const before = report("v1");
    const after = report("v2", { "PutObjectTagged@go-sdk": "", "CreateBucket@rust-sdk": "behaviour-mismatch" });
    const changes = diffReports(before, after);
    assert.equal(changes.length, 2);
    assert.deepEqual(changes.filter(isFixed).map((c) => `${c.test}@${c.suite}`), ["PutObjectTagged@go-sdk"]);
    assert.deepEqual(changes.filter(isRegressed).map((c) => `${c.test}@${c.suite}`), ["CreateBucket@rust-sdk"]);
  });

  it("trims long errors to one line", () => {
    assert.equal(trimError("a\n  b"), "a b");
    assert.equal(trimError("x".repeat(10), 5), "xxxx…");
    assert.equal(trimError(undefined), "");
  });

  it("encodes the explorer index compactly", () => {
    const index = buildExplorerIndex(report("v2", { "PutObjectTagged@go-sdk": "" }), naming, report("v1"));
    assert.equal(index.rows.length, 3);
    const put = index.rows[1];
    assert.equal(put[2], "PutObjectTagged");
    assert.equal(put[3], "PutObject");
    assert.deepEqual(put[4], [-1, 3]);
    assert.deepEqual(put[5], { 1: ["suite-not-written for PutObjectTagged", 42, ""] });
    // An op equal to its test name is not repeated.
    assert.equal(index.rows[0][3], "");
    assert.deepEqual(index.untested, [[1, "DeleteLoadBalancer", "never-probe", "destructive", 0]]);
    assert.equal(index.services[1].name, "ELBv2");
    assert.deepEqual(index.changed, { previous: "v1", fixed: ["s3/s3-crud/PutObjectTagged@go-sdk"], regressed: [] });
  });

  it("keeps a reason code the report does not describe", () => {
    const r = report("v1", { "CreateBucket@go-sdk": "brand-new-reason" });
    const index = buildExplorerIndex(r, naming);
    const code = index.rows[0][4][0] as number;
    assert.equal(index.reasons[code].code, "brand-new-reason");
    assert.equal(index.reasons.length, REASONS.length + 1);
  });
});

describe("compat-filter", () => {
  const prepared = prepare(buildExplorerIndex(report("v2", { "PutObjectTagged@go-sdk": "" }), naming, report("v1")));
  const run = (state: Partial<FilterState>) => evaluate(prepared, { ...EMPTY_STATE, ...state });

  it("round-trips the URL, dropping defaults and junk", () => {
    const state: FilterState = { q: "put object", outcomes: ["not-emulated", "pass"], whose: ["overcast"], suites: ["rust-sdk"], issue: "linked", changed: "fixed" };
    const query = serializeState(state, "v2");
    assert.equal(query, "?release=v2&q=put+object&outcome=not-emulated%2Cpass&whose=overcast&suite=rust-sdk&issue=linked&changed=fixed");
    assert.deepEqual(parseState(query), state);
    assert.equal(serializeState(EMPTY_STATE), "");
    assert.deepEqual(parseState("?whose=nobody&issue=maybe&changed=sideways"), EMPTY_STATE);
    assert.equal(isFiltered(EMPTY_STATE), false);
    assert.equal(isFiltered({ ...EMPTY_STATE, q: "  " }), false);
  });

  it("shows every row and counts every cell when nothing is filtered", () => {
    const result = run({});
    assert.equal(result.rows.length, 3);
    assert.equal(result.untested.length, 1);
    assert.equal(result.total, 7);
    assert.deepEqual(result.counts.outcome, { pass: 4, "suite-not-written": 2, untested: 1 });
    assert.equal(result.counts.suite["go-sdk"], 3);
  });

  it("matches every word, across names, errors and issue numbers", () => {
    assert.deepEqual(run({ q: "put object" }).rows.map((r) => r.prepared.test), ["PutObjectTagged"]);
    assert.deepEqual(run({ q: "elbv2" }).rows.map((r) => r.prepared.test), ["CreateLoadBalancer"]);
    assert.deepEqual(run({ q: "#42" }).rows.map((r) => r.prepared.test), ["PutObjectTagged"]);
    assert.equal(run({ q: "put nothing-like-this" }).rows.length, 0);
  });

  it("ranks an exact operation name first", () => {
    const rows = run({ q: "createloadbalancer" }).rows;
    assert.equal(rows[0].prepared.test, "CreateLoadBalancer");
  });

  it("combines facets, and masks the cells that do not match", () => {
    const result = run({ outcomes: ["suite-not-written"], suites: ["rust-sdk"] });
    assert.deepEqual(result.rows.map((r) => r.prepared.test), ["PutObjectTagged", "CreateLoadBalancer"]);
    assert.deepEqual(result.rows[0].mask, [false, true]);
    assert.equal(result.untested.length, 0, "a suite filter cannot describe an untested operation");
  });

  it("counts each facet with the others applied", () => {
    const result = run({ suites: ["rust-sdk"] });
    // Outcome counts follow the suite filter...
    assert.deepEqual(result.counts.outcome, { pass: 1, "suite-not-written": 2 });
    // ...and the suite counts ignore it, so the other suite's button says what it would show.
    assert.equal(result.counts.suite["go-sdk"], 3);
  });

  it("leaves passes out of the owner facet", () => {
    const result = run({ whose: ["suite"] });
    assert.equal(result.total, 2);
    assert.equal(result.counts.outcome.pass, undefined);
  });

  it("filters on issue links and on changes since the previous release", () => {
    assert.deepEqual(run({ issue: "linked" }).rows.map((r) => r.prepared.test), ["PutObjectTagged"]);
    const fixed = run({ changed: "fixed" });
    assert.deepEqual(fixed.rows.map((r) => `${r.prepared.test}`), ["PutObjectTagged"]);
    assert.deepEqual(fixed.rows[0].mask, [true, false]);
    assert.equal(fixed.counts.changed.fixed, 1);
  });

  it("finds untested operations by their outcome and reason text", () => {
    const result = run({ outcomes: ["untested"], q: "destructive" });
    assert.deepEqual(result.untested.map((u) => u.op), ["DeleteLoadBalancer"]);
    assert.equal(result.rows.length, 0);
  });
});

describe("compat detail and links", () => {
  it("groups clients that share an outcome, Overcast's gaps first", () => {
    const r = report("v1", { "CreateBucket@go-sdk": "suite-not-written", "CreateBucket@rust-sdk": "not-emulated" });
    const test = r.services[0].groups[0].tests[0];
    const groups = groupResults(test, r.suites, reasonByCode(r));
    assert.deepEqual(
      groups.map((g) => [g.reason, g.entries.map((e) => e.suite.id)]),
      [
        ["not-emulated", ["rust-sdk"]],
        ["suite-not-written", ["go-sdk"]],
      ],
    );
    const same = report("v1", { "CreateBucket@go-sdk": "not-emulated", "CreateBucket@rust-sdk": "not-emulated" });
    assert.equal(groupResults(same.services[0].groups[0].tests[0], same.suites, reasonByCode(same)).length, 1);
  });

  it("prefills an issue that links itself back through markers", () => {
    const suites = [
      { id: "go-sdk", label: "AWS SDK for Go v2" },
      { id: "rust-sdk", label: "AWS SDK for Rust" },
    ];
    const input = { issueRepo: "o/r", service: "s3", serviceName: "S3", group: "s3-crud", test: "PutObjectTagged", op: "PutObject", suites, reasonLabel: "Not emulated yet", error: "x".repeat(5000), version: "v1" };
    assert.deepEqual(issueMarkerTargets(input), ["s3/s3-crud/PutObjectTagged@go-sdk", "s3/s3-crud/PutObjectTagged@rust-sdk"]);
    const url = new URL(newIssueUrl(input));
    assert.equal(url.pathname, "/o/r/issues/new");
    assert.equal(url.searchParams.get("labels"), "compat");
    assert.equal(url.searchParams.get("title"), "Compat: S3 PutObject in 2 clients: not emulated yet");
    const body = url.searchParams.get("body") ?? "";
    // The marker scripts/compat-issues.py reads upstream, one target per client.
    assert.match(body, /<!-- compat:s3\/s3-crud\/PutObjectTagged@go-sdk, s3\/s3-crud\/PutObjectTagged@rust-sdk -->/);
    assert.ok(url.toString().length < 8000, "the error is trimmed so the URL stays usable");
  });

  it("writes markdown twins from the same numbers the pages show", () => {
    const r = report("v1");
    const options = { origin: "https://overcast.sh", report: r, naming, latest: true };
    const overview = compatOverviewMarkdown(options);
    assert.match(overview, /^# Overcast compatibility report, v1/);
    assert.match(overview, /Of the 4 results that measure Overcast, 3 pass \(75%\)/);
    assert.match(overview, /\[S3\]\(https:\/\/overcast\.sh\/compat\/s3\/index\.md\) \| 66\.6% \| 1\/2 \| 1\/1 \|/);
    assert.match(overview, /\[Not emulated yet\]\(https:\/\/overcast\.sh\/compat\/reason\/not-emulated\/index\.md\) \(1\)/);

    const service = compatServiceMarkdown("s3", options);
    assert.match(service, /### PutObjectTagged \(PutObject\)/);
    assert.match(service, /- AWS SDK for Go v2: Not emulated yet\./);
    // A test not yet written is condensed to one line per client, never listed as a failure.
    assert.match(service, /- Test not written for this SDK, AWS SDK for Rust: 1 test \(PutObjectTagged\)/);
    assert.doesNotMatch(service, /- AWS SDK for Rust: Test not written/);

    const reason = compatReasonMarkdown("untested", options);
    assert.match(reason, /- DeleteLoadBalancer: destructive/);

    // An archived release links to the explorer, since it has no per-service pages.
    assert.match(compatOverviewMarkdown({ ...options, latest: false }), /\/compat\/explore\/\?release=v1&outcome=not-emulated/);
  });
});
