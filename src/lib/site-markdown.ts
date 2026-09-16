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
