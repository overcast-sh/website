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
  return githubUrl(repo, ["stargazers"]);
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
