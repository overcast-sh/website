// The one-line installers, install.sh and install.ps1, are authored in overcast-sh/overcast
// under install/ and served from this site's root (src/pages/install.sh.ts and
// install.ps1.ts). This file is the import-free part: the release-tag bake and the
// placeholder served when the Overcast checkout predates the scripts. Reading the checkout
// lives in install-scripts-source.ts so this can be unit-tested by install-scripts.test.ts.
//
// Each script carries one marker line, empty in the repository, that the upstream release
// workflow rewrites with the release tag (install/bake.py there). The site does the same
// substitution for the release it is built from, so an install from overcast.sh makes no
// GitHub API call to find "latest" — the unauthenticated API allows sixty requests an hour
// per address, which one office behind a NAT exhausts. The two implementations must agree
// on the marker; a script that lost it would silently fall back to the API, which is why
// bake() refuses anything but exactly one match.

export type InstallScriptName = "install.sh" | "install.ps1";

export const installScriptNames: InstallScriptName[] = ["install.sh", "install.ps1"];

const markers: Record<InstallScriptName, { pattern: RegExp; replacement: (tag: string) => string }> = {
  "install.sh": {
    pattern: /^OVERCAST_INSTALL_BAKED_VERSION=""$/m,
    replacement: (tag) => `OVERCAST_INSTALL_BAKED_VERSION="${tag}"`,
  },
  "install.ps1": {
    pattern: /^\$BakedVersion = ""$/m,
    replacement: (tag) => `$BakedVersion = "${tag}"`,
  },
};

const tagPattern = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** `0.0.1-alpha.40` or `v0.0.1-alpha.40` → `v0.0.1-alpha.40`; anything else → null. */
export function normaliseReleaseTag(version: string): string | null {
  const trimmed = version.trim();
  if (!tagPattern.test(trimmed)) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

/**
 * Returns `text` with its baked-version marker set to `tag`. Line endings are preserved:
 * install.sh is LF and install.ps1 is CRLF in the upstream checkout, and neither may change
 * on the way through — a CRLF install.sh is a script `sh` cannot run.
 *
 * Throws when the marker is missing or appears more than once, because either means the
 * script and this bake have drifted apart and the honest failure is a build error, not an
 * installer that quietly falls back to the API.
 */
export function bakeInstallScript(text: string, script: InstallScriptName, tag: string): string {
  if (tag.includes('"')) throw new Error(`install-scripts: tag may not contain a double quote: ${tag}`);
  const { pattern, replacement } = markers[script];
  const crlf = text.includes("\r\n");
  const lf = text.replaceAll("\r\n", "\n");
  const matches = lf.match(new RegExp(pattern.source, "gm")) ?? [];
  if (matches.length !== 1) {
    throw new Error(`install-scripts: ${script} should carry exactly one baked-version marker, found ${matches.length}`);
  }
  const baked = lf.replace(pattern, replacement(tag));
  return crlf ? baked.replaceAll("\n", "\r\n") : baked;
}

/**
 * What /install.sh and /install.ps1 serve when the Overcast release the site is built from
 * predates the installers. A valid script in each language that says so and exits non-zero,
 * so `curl | sh` and `irm | iex` fail with a next step rather than a 404 page piped into a
 * shell. Goes away on its own with the first release that ships install/.
 */
export function placeholderInstallScript(script: InstallScriptName, sourceRef: string, releasesUrl: string): string {
  const message = `The Overcast release this site is built from (${sourceRef}) predates the one-line installer. Download a binary from ${releasesUrl} for now; the next release carries the installer.`;
  if (script === "install.sh") {
    return [
      "#!/bin/sh",
      "# Overcast installer placeholder.",
      `echo "${message}" >&2`,
      "exit 1",
      "",
    ].join("\n");
  }
  return [
    "# Overcast installer placeholder.",
    `Write-Error "${message}"`,
    "exit 1",
    "",
  ].join("\r\n");
}
