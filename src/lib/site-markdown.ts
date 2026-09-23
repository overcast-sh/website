/**
 * Markdown twins for the site's own pages — the ones that aren't synced docs and so have no
 * markdown to serve.
 *
 * llmstxt.org v2 asks that "pages with information that agents might need provide a clean
 * markdown version of those pages at the same URL as the original page", and names the form
 * for a URL with no file name: append index.md. Every route on this site is directory-style
 * (`/support/`, `/docs/storage/`), so every twin is an index.md, and src/pages/[...slug].md.ts
 * serves them all.
 *
 * Each builder below renders from the same data its .astro page renders from — the support
 * manifest, the releases collection, the docs collection — so a twin cannot drift from the
 * page it mirrors. The two prose pages that have no underlying data (/console/,
 * /contributing/) get a deliberately short twin that says what the thing is and points at
 * the canonical source, rather than a second copy of the page's copy that would rot.
 *
 * Every function here is pure: data in, string out, so `npm test` exercises them with no
 * build and no collection.
 */
import { coverageTierLabel, type ServiceSupportManifest } from "./generated-content.ts";
import {
  WHOSE_LABELS,
  WHOSE_ORDER,
  countByWhose,
  matrixRow,
  measured,
  percent,
  reasonByCode,
  reasonCount,
  reasonsInUse,
  serviceDisplayName,
  serviceMeasured,
  type CompatReason,
  type CompatReport,
  type ServiceNaming,
} from "./compat-report.ts";

export interface MarkdownPageOptions {
  /** Absolute origin, so a reader that fetched this file can follow every link in it. */
  origin: string;
}

function absolute(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

/** A markdown table, or a plain line when there are no rows to put in one. */
function table(headers: readonly string[], rows: readonly (readonly string[])[], empty: string): string {
  if (rows.length === 0) return empty;
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function page(title: string, summary: string, blocks: readonly string[]): string {
  return `${[`# ${title}`, "", summary, ...blocks.flatMap((block) => ["", block])].join("\n")}\n`;
}

/**
 * /support/index.md — the coverage matrix.
 *
 * Service level only, exactly like the page it mirrors: 50 rows rather than the ~2,000 that
 * listing every operation inline would produce. The per-operation detail already has a
 * markdown home, one page per service, and each row links to it.
 */
export function supportMarkdown(manifest: ServiceSupportManifest, { origin }: MarkdownPageOptions): string {
  const services = [...manifest.services].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const gap = manifest.totalOps - manifest.implementedOps;

  const rows = services.map((service) => {
    const percent = service.totalOps ? Math.round((service.implementedOps / service.totalOps) * 100) : 0;
    const docs = absolute(origin, `/docs/services/${service.docSlug ?? service.service}/index.md`);
    return [
      `[${service.displayName}](${docs})`,
      `${service.implementedOps}/${service.totalOps}`,
      `${percent}%`,
      coverageTierLabel(service.coverageTier),
    ];
  });

  return page("Overcast support matrix", "> Which listed API operations Overcast implements, per service.", [
    `Of ${manifest.totalOps} listed operations across ${services.length} services, ${manifest.implementedOps} are implemented and ${gap} return HTTP 501.`,
    "This counts listed API operations, and is not a claim of full AWS compatibility: behaviour is alpha, and a supported operation may still differ from AWS at the edges. Each service links to its own reference, where the per-operation detail and the known limitations live.",
    table(["Service", "Implemented", "Coverage", "Tier"], rows, "_No service data in this build._"),
  ]);
}

export interface ReleaseLike {
  tagName: string;
  name: string;
  publishedAt: string | null;
  url?: string;
  prerelease?: boolean;
  assets?: readonly { name: string; downloadUrl?: string; size?: number }[];
}

/** /releases/index.md — the release history, newest first. */
export function releasesMarkdown(releases: readonly ReleaseLike[], { origin }: MarkdownPageOptions): string {
  const rows = releases.map((release) => [
    release.url ? `[${release.tagName}](${release.url})` : release.tagName,
    release.publishedAt ? release.publishedAt.slice(0, 10) : "unreleased",
    release.prerelease ? "pre-release" : "release",
  ]);

  return page("Overcast releases", "> Every published Overcast release, newest first.", [
    `Release notes for each one are on GitHub. Downloads and install commands are at ${absolute(origin, "/downloads/index.md")}.`,
    table(["Version", "Published", "Kind"], rows, "_No releases published yet._"),
  ]);
}

export interface DownloadsOptions extends MarkdownPageOptions {
  latest?: ReleaseLike;
  /** The docker run invocations the page shows, so the two can't diverge. */
  commands: readonly { label: string; command: string }[];
}

/** /downloads/index.md — how to get Overcast, and what the latest release ships. */
export function downloadsMarkdown({ latest, commands, origin }: DownloadsOptions): string {
  const assets = latest?.assets ?? [];
  const rows = assets.map((asset) => [
    asset.downloadUrl ? `[${asset.name}](${asset.downloadUrl})` : asset.name,
    asset.size ? `${(asset.size / 1_000_000).toFixed(1)} MB` : "—",
  ]);

  return page("Download Overcast", "> Docker images and native binaries for the current Overcast release.", [
    latest ? `The current release is ${latest.tagName}${latest.publishedAt ? `, published ${latest.publishedAt.slice(0, 10)}` : ""}.` : "No release has been published yet.",
    ...commands.map(({ label, command }) => `${label}\n\n\`\`\`bash\n${command}\n\`\`\``),
    "## Release assets",
    table(["Asset", "Size"], rows, "_The current release publishes no binary assets._"),
    `Installing, verifying and upgrading are covered at ${absolute(origin, "/docs/install/index.md")}.`,
  ]);
}

export interface HomeOptions extends MarkdownPageOptions {
  /** The quickstart the home page shows, from the same constants it renders. */
  commands: readonly { label: string; command: string }[];
  serviceCount: number;
  latestVersion?: string;
}

/** /index.md — what Overcast is, and the two commands that prove it. */
export function homeMarkdown({ commands, serviceCount, latestVersion, origin }: HomeOptions): string {
  return page(
    "Overcast",
    "> Overcast is a free, MIT-licensed local emulator for AWS APIs. Develop and test against AWS-compatible services on your laptop and in CI, with no internet connection, no cloud account, and no bill.",
    [
      `It emulates ${serviceCount} services behind one endpoint on port 4566, and ships a web console on 4567 that shows what your app created.${latestVersion ? ` The current release is ${latestVersion}.` : ""} Coverage is per operation and the project is alpha — the support matrix below has the detail.`,
      ...commands.map(({ label, command }) => `${label}\n\n\`\`\`bash\n${command}\n\`\`\``),
      "## Where to go next",
      [
        `- [Documentation](${absolute(origin, "/docs/index.md")}): guides and reference.`,
        `- [Support matrix](${absolute(origin, "/support/index.md")}): what each service implements.`,
        `- [Downloads](${absolute(origin, "/downloads/index.md")}): images, binaries and install commands.`,
        `- [llms.txt](${absolute(origin, "/llms.txt")}): the index into all of the above, for agents.`,
      ].join("\n"),
    ],
  );
}

/**
 * /console/index.md — short on purpose. The console's feature-by-feature detail already has
 * a markdown home in the synced docs; a second copy here would be the duplication these
 * twins exist to avoid, and it would rot the first time the console gained a panel.
 */
export function consoleMarkdown({ origin }: MarkdownPageOptions): string {
  return page(
    "Overcast web console",
    "> The browser UI bundled with Overcast, served on port 4567 beside the API on 4566.",
    [
      "It shows what your app actually created rather than what it asked for: a browser for every emulated service, an inbox holding captured mail, a live event stream, request traces, and a topology map of the resources in the running emulator.",
      `There is nothing to install — it ships inside the image and starts with the emulator. The feature reference is at ${absolute(origin, "/docs/reference/index.md")}. The traces view needs \`OVERCAST_DEBUG=true\`, covered at ${absolute(origin, "/docs/debug-endpoints/index.md")}.`,
    ],
  );
}

export interface ContributingOptions extends MarkdownPageOptions {
  /** The Overcast repository, which owns the documentation this site renders. */
  repositoryUrl: string;
  websiteRepositoryUrl: string;
}

/**
 * /contributing/index.md — also short, and for a second reason: the thing a contributor most
 * needs to know is which of the two repositories their change belongs in, and the long form
 * of everything else is a CONTRIBUTING.md in each of them.
 */
export function contributingMarkdown({ repositoryUrl, websiteRepositoryUrl }: ContributingOptions): string {
  return page("Contributing to Overcast", "> Where a change goes, and where the long form lives.", [
    `Documentation content is written in the Overcast repository, ${repositoryUrl}, and this site renders it at build time. Corrections, new pages and wording changes belong there, in \`docs/\` — the "Edit this page" link on every docs page goes straight to the file.`,
    `The site itself — layout, navigation, search, styling, and the pages that aren't docs — is ${websiteRepositoryUrl}.`,
    `Each repository has a CONTRIBUTING.md with its setup, its checks and what it expects of a pull request, and an AGENTS.md for agent-assisted work.`,
  ]);
}

export interface DocsIndexOptions extends MarkdownPageOptions {
  sections: readonly { section: string; entries: readonly { title: string; slug: string; description: string }[] }[];
}

/** /docs/index.md — the documentation landing page, grouped as the sidebar groups it. */
export function docsIndexMarkdown({ sections, origin }: DocsIndexOptions): string {
  const blocks = sections.map(({ section, entries }) =>
    [
      `## ${section}`,
      "",
      ...entries.map((entry) => `- [${entry.title}](${absolute(origin, `/${entry.slug}/index.md`)}): ${entry.description}`),
    ].join("\n"),
  );

  return page("Overcast documentation", "> Every guide and reference page for Overcast, a local emulator for AWS APIs.", [
    `Per-service reference is indexed separately, at ${absolute(origin, "/docs/services/llms.txt")}.`,
    ...blocks,
  ]);
}

// ── Compatibility report ─────────────────────────────────────────────────────

export interface CompatMarkdownOptions extends MarkdownPageOptions {
  report: CompatReport;
  naming: ServiceNaming;
  /** The newest release has per-service pages; an archived one links to the explorer. */
  latest: boolean;
}

/** "1 result is" / "3 results are". */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One reason as a markdown line, for the "why" sections. */
function reasonLine(report: CompatReport, reason: CompatReason, href: string): string {
  return `- [${reason.label}](${href}) (${reasonCount(report, reason.code)}): ${reason.summary}`;
}

/**
 * /compat/index.md (and /compat/history/<tag>/index.md) — the overview: the headline numbers,
 * every reason by owner, and the service × client matrix as a table.
 */
export function compatOverviewMarkdown({ report, naming, latest, origin }: CompatMarkdownOptions): string {
  const reasons = reasonByCode(report);
  const headline = measured(report.totals, reasons);
  const whose = countByWhose(report.totals, reasons);
  const inUse = reasonsInUse(report);
  const reasonHref = (code: string) =>
    latest
      ? absolute(origin, `/compat/reason/${code}/index.md`)
      : absolute(origin, `/compat/explore/?release=${encodeURIComponent(report.version)}&outcome=${code}`);

  const whyBlocks = WHOSE_ORDER.map((owner) => {
    const group = inUse.filter((reason) => reason.whose === owner);
    if (!group.length) return "";
    return [
      `### ${WHOSE_LABELS[owner].title} (${whose[owner]})`,
      "",
      WHOSE_LABELS[owner].blurb,
      "",
      ...group.map((reason) => reasonLine(report, reason, reasonHref(reason.code))),
    ].join("\n");
  }).filter(Boolean);

  const services = [...report.services].sort((a, b) =>
    serviceDisplayName(a.id, naming).localeCompare(serviceDisplayName(b.id, naming)),
  );
  const rows = services.map((service) => {
    const m = serviceMeasured(service, report.suites, reasons);
    const name = serviceDisplayName(service.id, naming);
    const cells = matrixRow(service, report.suites, reasons).map((cell) =>
      cell.cells === 0 ? "—" : cell.ran ? `${cell.pass}/${cell.ran}` : "no test",
    );
    const label = latest ? `[${name}](${absolute(origin, `/compat/${service.id}/index.md`)})` : name;
    return [label, `${percent(m.pass, m.ran)}%`, ...cells];
  });
  const releaseUrl = `https://github.com/${report.issueRepo}/releases/tag/${report.version}`;

  return page(
    `Overcast compatibility report, ${report.version}`,
    "> Tested compatibility across six AWS SDKs, the AWS CLI and the CDK, with the reason for every result that does not pass.",
    [
      `Of the ${headline.ran} results that measure Overcast, ${headline.pass} pass (${percent(headline.pass, headline.ran)}%). ${plural(headline.ran - headline.pass, "result is", "results are")} for Overcast to fix, ${plural(whose.suite, "is a test", "are tests")} not yet written or settled for a client, and ${plural(whose.none, "operation has", "operations have")} no test. A test not yet written for a language, an operation an SDK cannot call, or a test blocked by an earlier failure is left out of the rate.`,
      `The full data is the \`compat-report.json\` asset on the release, ${releaseUrl}. Every result can be searched at ${absolute(origin, "/compat/explore/")}.`,
      "## Why results do not pass",
      ...whyBlocks,
      "## By service and client",
      "Passing results over results that measure Overcast.",
      table(["Service", "Rate", ...report.suites.map((suite) => suite.label)], rows, "_No results in this report._"),
    ],
  );
}

/**
 * /compat/<service>/index.md — every test Overcast does not yet pass, with the reason and the
 * evidence, per client. Results that say nothing about Overcast (a test not yet written for a
 * language, an SDK with no API) are condensed to one line per reason and client, or a service
 * with a young Rust suite would bury its three real failures under sixty identical lines.
 */
export function compatServiceMarkdown(serviceId: string, { report, naming, origin }: CompatMarkdownOptions): string {
  const service = report.services.find((s) => s.id === serviceId);
  const name = serviceDisplayName(serviceId, naming);
  if (!service) return page(`${name} compatibility`, "> No results for this service in this report.", []);
  const reasons = reasonByCode(report);
  const m = serviceMeasured(service, report.suites, reasons);
  const labels = new Map(report.suites.map((suite) => [suite.id, suite.label]));
  const tests = service.groups.flatMap((group) => group.tests.map((test) => ({ group: group.id, test })));
  const detailed = (code: string) => reasons.get(code)?.whose === "overcast" || code === "candidate";

  const blocks = tests
    .filter(({ test }) => Object.values(test.results).some((result) => result.reason && detailed(result.reason)))
    .map(({ group, test }) => {
      const lines = Object.entries(test.results)
        .filter(([, result]) => result.reason && detailed(result.reason))
        .map(([suite, result]) => {
          const reason = reasons.get(result.reason ?? "");
          const issue = result.issue ? ` Tracked in ${result.issue.url}.` : "";
          let evidence = "";
          if (result.mismatch) {
            const at = result.mismatch.path ? ` at \`${result.mismatch.path}\`` : "";
            evidence = ` ${result.mismatch.kind}${at}: expected ${result.mismatch.expected}, actual ${result.mismatch.actual}.`;
          } else if (result.blockedBy?.length) {
            evidence = ` Blocked by ${result.blockedBy.join(", ")}.`;
          }
          return `- ${labels.get(suite) ?? suite}: ${reason?.label ?? result.reason}.${evidence}${issue}`;
        });
      const heading = `### ${test.name}${test.op !== test.name ? ` (${test.op})` : ""}`;
      return [heading, "", `Group \`${group}\`.`, "", ...lines].join("\n");
    });

  // Everything else, one line per reason and client: "AWS SDK for Rust: 60 tests (CreateUser, …)".
  const condensed = new Map<string, string[]>();
  for (const { test } of tests) {
    for (const [suite, result] of Object.entries(test.results)) {
      if (!result.reason || detailed(result.reason)) continue;
      const key = `${reasons.get(result.reason)?.label ?? result.reason}|${labels.get(suite) ?? suite}`;
      condensed.set(key, [...(condensed.get(key) ?? []), test.name]);
    }
  }
  const otherLines = [...condensed].map(([key, names]) => {
    const [label, client] = key.split("|");
    return `- ${label}, ${client}: ${names.length} ${names.length === 1 ? "test" : "tests"} (${names.join(", ")})`;
  });

  const untested = (service.untested ?? []).map((gap) => `- ${gap.op} (\`${gap.code}\`): ${gap.detail}`);

  return page(`${name} compatibility, ${report.version}`, `> Compatibility test results for ${name} in Overcast ${report.version}.`, [
    `${tests.length} tests. Of the ${m.ran} results that measure Overcast, ${m.pass} pass (${percent(m.pass, m.ran)}%). ${blocks.length} tests have a result Overcast has to act on, listed below with the evidence.`,
    `The overview, with every service, is at ${absolute(origin, "/compat/index.md")}.`,
    ...(blocks.length ? ["## Tests Overcast does not yet pass", ...blocks] : []),
    ...(otherLines.length ? ["## Not measured", "Results that say nothing about Overcast itself.", otherLines.join("\n")] : []),
    ...(untested.length
      ? ["## Not tested", "Operations with no test. The generator declined to write one, for the reason given.", untested.join("\n")]
      : []),
  ]);
}

/** /compat/reason/<code>/index.md — every result with one reason, by service. */
export function compatReasonMarkdown(code: string, { report, naming, origin }: CompatMarkdownOptions): string {
  const reason = report.reasons.find((r) => r.code === code);
  const label = reason?.label ?? code;
  const labels = new Map(report.suites.map((suite) => [suite.id, suite.label]));
  const blocks = report.services
    .map((service) => {
      const lines = service.groups.flatMap((group) =>
        group.tests
          .map((test) => ({
            test,
            suites: Object.entries(test.results)
              .filter(([, result]) => result.reason === code)
              .map(([suite]) => labels.get(suite) ?? suite),
          }))
          .filter(({ suites }) => suites.length)
          .map(({ test, suites }) => `- ${test.name}${test.op !== test.name ? ` (${test.op})` : ""}: ${suites.join(", ")}`),
      );
      const gaps = code === "untested" ? (service.untested ?? []).map((gap) => `- ${gap.op}: ${gap.detail}`) : [];
      const all = [...lines, ...gaps];
      return all.length ? [`## ${serviceDisplayName(service.id, naming)}`, "", ...all].join("\n") : "";
    })
    .filter(Boolean);

  return page(`${label}: Overcast ${report.version} compatibility`, `> ${reason?.summary ?? label}`, [
    `${reasonCount(report, code)} ${code === "untested" ? "operations" : "results"}. The overview is at ${absolute(origin, "/compat/index.md")}.`,
    ...blocks,
  ]);
}

/** /compat/explore/index.md — the explorer is interactive; its twin says where the data is. */
export function compatExploreMarkdown({ origin }: MarkdownPageOptions): string {
  return page("Explore compatibility results", "> Search and filter every Overcast compatibility test result.", [
    `The page filters one compact index per release, served at ${absolute(origin, "/compat/data/")}<release>.json. The full report for a release is its \`compat-report.json\` release asset, and the overview is at ${absolute(origin, "/compat/index.md")}.`,
  ]);
}
