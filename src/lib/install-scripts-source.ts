import fs from "node:fs/promises";
import path from "node:path";
import { exists, overcastSourceRef, resolveOvercastSourceRoot } from "../loaders/overcast-source";
import { repositoryUrl } from "./github-links";
import { bakeInstallScript, normaliseReleaseTag, placeholderInstallScript, type InstallScriptName } from "./install-scripts";

// The site builds from the Overcast checkout of the release it publishes, so that checkout's
// VERSION file names the release the installer should default to. Falling back to the source
// ref covers a checkout without the file; a ref that is not a version (a branch name) leaves
// the marker empty, and the script resolves "latest" through the GitHub API instead.
async function releaseTagOfCheckout(sourceRoot: string): Promise<string | null> {
  const versionFile = path.join(sourceRoot, "VERSION");
  if (await exists(versionFile)) {
    const tag = normaliseReleaseTag(await fs.readFile(versionFile, "utf8"));
    if (tag) return tag;
  }
  return normaliseReleaseTag(overcastSourceRef);
}

/** The body /install.sh or /install.ps1 serves: the upstream script with the release baked
 * in, or a placeholder when the release predates install/. */
export async function loadInstallScript(script: InstallScriptName): Promise<string> {
  const sourceRoot = await resolveOvercastSourceRoot();
  const scriptPath = path.join(sourceRoot, "install", script);
  if (!(await exists(scriptPath))) {
    console.warn(`install-scripts: ${scriptPath} is not in this release yet — serving a placeholder /${script}.`);
    return placeholderInstallScript(script, overcastSourceRef, `${repositoryUrl()}/releases`);
  }
  const text = await fs.readFile(scriptPath, "utf8");
  const tag = await releaseTagOfCheckout(sourceRoot);
  return tag ? bakeInstallScript(text, script, tag) : text;
}
