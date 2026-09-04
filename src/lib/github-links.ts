import path from "node:path";
// Explicit extension so Node's test runner can resolve this module without a bundler —
// github-links.test.ts imports this file directly. Astro/Vite resolve it either way.
import { resolveOvercastSourceRoot } from "../loaders/overcast-source.ts";

export const overcastGitHubRepo = process.env.OVERCAST_REPO || "overcast-sh/overcast";
export const overcastEditRef = process.env.OVERCAST_EDIT_REF || "main";
export const websiteGitHubRepo = process.env.WEBSITE_REPO || "overcast-sh/website";
export const websiteEditRef = process.env.WEBSITE_EDIT_REF || "main";

type EditLinkMode = "auto" | "github" | "vscode";

function githubUrl(repo: string, segments: string[]): string {
  return `https://github.com/${repo}/${segments.map(encodeURIComponent).join("/")}`;
}

function editLinkMode(): EditLinkMode {
  const mode = process.env.EDIT_LINK_MODE;
  if (mode === "github" || mode === "vscode") return mode;
  return "auto";
}

function shouldUseVscodeEditLinks(): boolean {
  const mode = editLinkMode();
  if (mode === "github") return false;
  if (mode === "vscode") return true;
  return import.meta.env.DEV;
}

function vscodeFileUrl(filePath: string): string {
  const normalized = path.resolve(filePath).replaceAll("\\", "/");
  return encodeURI(`vscode://file/${normalized}`);
}

export function repositoryUrl(repo = overcastGitHubRepo): string {
  return `https://github.com/${repo}`;
}

export function starsUrl(repo = overcastGitHubRepo): string {
  // The repo page, not /stargazers: GitHub 404s the stargazers page while a
  // repo has zero stars, and the star button lives on the repo page anyway.
  return repositoryUrl(repo);
}

export function editUrl(repo: string, ref: string, filePath: string): string {
  return githubUrl(repo, ["edit", ref, ...filePath.split("/")]);
}

export async function overcastEditUrl(sourcePath: string): Promise<string> {
  if (shouldUseVscodeEditLinks()) {
    return vscodeFileUrl(path.join(await resolveOvercastSourceRoot(), sourcePath));
  }
  return editUrl(overcastGitHubRepo, overcastEditRef, sourcePath);
}

export function websiteEditUrl(sourcePath: string): string {
  if (shouldUseVscodeEditLinks()) {
    return vscodeFileUrl(path.join(process.cwd(), sourcePath));
  }
  return editUrl(websiteGitHubRepo, websiteEditRef, sourcePath);
}

export function websiteEditUrlFromRoute(routePattern: string): string | undefined {
  if (routePattern.includes("[")) return undefined;

  const routePath = routePattern.replace(/^\/|\/$/g, "");
  const sourcePath = routePath.length === 0 ? "src/pages/index.astro" : `src/pages/${routePath}.astro`;
  return websiteEditUrl(sourcePath);
}

/**
 * Overcast lived under the `Neaox` GitHub org / `ghcr.io/neaox` image namespace before it
 * moved to `overcast-sh`. Historical content pulled from upstream (old GitHub release
 * bodies, doc pages that haven't been touched since the rename) still references the old
 * org, and those references will never be edited upstream. Rewrite them at build time so
 * the published site never shows a dead `neaox` link.
 */
const legacyGhcrPattern = /ghcr\.io\/neaox\//gi;
const legacyGithubOvercastPattern = /github\.com\/neaox\/overcast/gi;
const legacyNeaoxTokenPattern = /\bneaox\b/gi;

// Non-global counterparts used only to test whether a line contains a reference, never to
// replace: a global regex's `.test()` keeps advancing `lastIndex` across calls, so reusing
// the replace patterns above for this would silently flip results between lines.
const legacyReferenceDetector = /ghcr\.io\/neaox\/|github\.com\/neaox\/overcast|\bneaox\b/i;
const newOrgReferenceDetector = /overcast-sh/i;

export function rewriteLegacyOrgReferences(text: string): string {
  if (!text) return text;
  return text
    .split("\n")
    .map((line) => {
      // A line that already mentions overcast-sh alongside a legacy reference is a
      // from -> to migration note (release notes for the org rename itself document the
      // change this way) rather than stale content to fix. Rewriting it would turn
      // "github.com/Neaox/overcast -> github.com/overcast-sh/overcast" into
      // "github.com/overcast-sh/overcast -> github.com/overcast-sh/overcast" and read as
      // a no-op, so leave the whole line verbatim.
      if (newOrgReferenceDetector.test(line) && legacyReferenceDetector.test(line)) {
        return line;
      }
      return line
        .replace(legacyGhcrPattern, "ghcr.io/overcast-sh/")
        .replace(legacyGithubOvercastPattern, "github.com/overcast-sh/overcast")
        .replace(legacyNeaoxTokenPattern, "overcast-sh");
    })
    .join("\n");
}

/**
 * TEMPORARY — delete this, its test, and the call in src/loaders/overcast-docs.ts once the
 * synced release contains overcast-sh/overcast#1641.
 *
 * The repo README's container-image badge asks shields.io for
 * `badge/ghcr.io-overcast-sh%2Fovercast-blue`. Shields splits a `/badge/` path on `-` into
 * label, message and colour, so the dash inside `overcast-sh` makes four fields where three
 * are allowed and shields answers with its own "404 badge not found" image — which is what
 * the docs Overview page renders, since it is that README. Shields' escape for a literal
 * dash is a doubled one. #1641 fixes the README upstream; the site only picks that up at the
 * next release, so repair the URL on the way through until then.
 */
const unescapedGhcrBadgePattern = /badge\/ghcr\.io-overcast-sh%2Fovercast-blue/g;

export function rewriteContainerImageBadge(text: string): string {
  if (!text) return text;
  return text.replace(unescapedGhcrBadgePattern, "badge/ghcr.io-overcast--sh%2Fovercast-blue");
}
