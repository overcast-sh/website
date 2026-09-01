import path from "node:path";
import { resolveOvercastSourceRoot } from "../loaders/overcast-source";

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

export function rewriteLegacyOrgReferences(text: string): string {
  if (!text) return text;
  return text
    .replace(legacyGhcrPattern, "ghcr.io/overcast-sh/")
    .replace(legacyGithubOvercastPattern, "github.com/overcast-sh/overcast")
    .replace(legacyNeaoxTokenPattern, "overcast-sh");
}
