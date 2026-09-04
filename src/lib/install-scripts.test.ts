import assert from "node:assert/strict";
import { test } from "node:test";
import { bakeInstallScript, normaliseReleaseTag, placeholderInstallScript } from "./install-scripts.ts";

const sh = ['#!/bin/sh', 'set -eu', 'OVERCAST_INSTALL_BAKED_VERSION=""', 'main "$@"', ""].join("\n");
const ps1 = ["param()", '$BakedVersion = ""', "Main", ""].join("\r\n");

test("normaliseReleaseTag accepts a version with or without the v and rejects the rest", () => {
  assert.equal(normaliseReleaseTag("0.0.1-alpha.40"), "v0.0.1-alpha.40");
  assert.equal(normaliseReleaseTag("v1.2.3\n"), "v1.2.3");
  assert.equal(normaliseReleaseTag("latest"), null);
  assert.equal(normaliseReleaseTag('v1.0.0"; rm -rf /'), null);
  assert.equal(normaliseReleaseTag(""), null);
});

test("bakeInstallScript sets the marker in install.sh and keeps LF", () => {
  const baked = bakeInstallScript(sh, "install.sh", "v0.0.1-alpha.40");
  assert.match(baked, /^OVERCAST_INSTALL_BAKED_VERSION="v0\.0\.1-alpha\.40"$/m);
  assert.doesNotMatch(baked, /OVERCAST_INSTALL_BAKED_VERSION=""/);
  assert.equal(baked.includes("\r\n"), false);
});

test("bakeInstallScript sets the marker in install.ps1 and keeps CRLF", () => {
  const baked = bakeInstallScript(ps1, "install.ps1", "v0.0.1-alpha.40");
  assert.ok(baked.includes('$BakedVersion = "v0.0.1-alpha.40"\r\n'));
  assert.equal(baked.includes('$BakedVersion = ""'), false);
  assert.equal(baked.split("\r\n").length, ps1.split("\r\n").length);
});

test("bakeInstallScript refuses a script without exactly one marker", () => {
  assert.throws(() => bakeInstallScript("echo hi\n", "install.sh", "v1.0.0"), /exactly one baked-version marker, found 0/);
  assert.throws(() => bakeInstallScript(sh + sh, "install.sh", "v1.0.0"), /found 2/);
  assert.throws(() => bakeInstallScript(sh, "install.sh", 'v1"'), /double quote/);
});

test("placeholderInstallScript is a script in each language that fails with a next step", () => {
  const shell = placeholderInstallScript("install.sh", "v0.0.1-alpha.40", "https://example.test/releases");
  assert.ok(shell.startsWith("#!/bin/sh\n"));
  assert.ok(shell.includes("https://example.test/releases"));
  assert.ok(shell.trimEnd().endsWith("exit 1"));
  const powershell = placeholderInstallScript("install.ps1", "v0.0.1-alpha.40", "https://example.test/releases");
  assert.ok(powershell.includes("Write-Error"));
  assert.ok(powershell.includes("\r\n"));
});
