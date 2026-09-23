/**
 * The "Report this" link on a compatibility result with no tracking issue: a new-issue form,
 * prefilled, carrying the marker (`<!-- compat:<target>, <target> -->`) that
 * scripts/compat-issues.py in overcast-sh/overcast reads. Filing it is enough for the next
 * release's report to link every listed client's result to the issue; nobody edits a mapping file.
 */

export interface IssueLinkInput {
  issueRepo: string;
  service: string;
  serviceName: string;
  group: string;
  test: string;
  op: string;
  /** The clients that share this outcome. */
  suites: { id: string; label: string }[];
  reasonLabel: string;
  error?: string;
  version: string;
}

/** Long enough to recognise the failure, short enough to keep the URL well under 8 KB. */
const ERROR_LIMIT = 1500;

/** The marker targets for one test in the given clients: service/group/test@suite. */
export function issueMarkerTargets({ service, group, test, suites }: Pick<IssueLinkInput, "service" | "group" | "test" | "suites">): string[] {
  return suites.map((suite) => `${service}/${group}/${test}@${suite.id}`);
}

export function newIssueUrl(input: IssueLinkInput): string {
  const { issueRepo, serviceName, op, suites, reasonLabel, error, version, group, test } = input;
  const clients = suites.length === 1 ? suites[0].label : `${suites.length} clients`;
  const title = `Compat: ${serviceName} ${op} in ${clients}: ${reasonLabel.toLowerCase()}`;
  const message = error ? (error.length > ERROR_LIMIT ? `${error.slice(0, ERROR_LIMIT)}…` : error) : "";
  const body = [
    `**Service:** ${serviceName}`,
    `**Operation:** ${op} (test \`${group}/${test}\`)`,
    `**Clients:** ${suites.map((suite) => suite.label).join(", ")}`,
    `**Release:** ${version}`,
    `**Reported as:** ${reasonLabel}`,
    "",
    ...(message ? ["```", message, "```", ""] : []),
    "<!-- Links this issue from the compatibility report on overcast.sh. Keep it. -->",
    `<!-- compat:${issueMarkerTargets(input).join(", ")} -->`,
  ].join("\n");
  const params = new URLSearchParams({ title, body, labels: "compat" });
  return `https://github.com/${issueRepo}/issues/new?${params.toString()}`;
}
