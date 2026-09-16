// Decides whether a freshly captured set of console screenshots can merge itself.
//
// Run after scripts/capture-console.mjs, against a copy of the screenshots as they were
// committed:
//   node scripts/audit-screenshots.mjs --baseline .tmp/screenshot-baseline
//
// Options (env or CLI):
//   --baseline=          the committed screenshots, copied aside before the capture
//                        overwrote them (default .tmp/screenshot-baseline)
//   --current=           the freshly captured ones (default public/console)
//   --capture-audit=     the page-log warnings capture-console.mjs wrote
//                        (default .tmp/capture-audit.json)
//   --output=            where to write the verdict as JSON (default .tmp/screenshot-audit.json)
//
// Exits 0 whichever way it lands — "a human should look at this" is a result, not a failure,
// and a red job here would leave the screenshots stale, which is the thing being avoided. On
// GitHub it appends `verdict`, `table` and `reasons` to $GITHUB_OUTPUT for the workflow to
// route on. The thresholds and the verdict logic live in src/lib/screenshot-audit.ts, where
// they are unit tested.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import { auditVerdict, changedPixelRatio, formatComparisonTable } from "../src/lib/screenshot-audit.ts";

const cwd = process.cwd();

function flag(name, fallback) {
  const match = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

const baselineDir = path.resolve(cwd, flag("baseline", ".tmp/screenshot-baseline"));
const currentDir = path.resolve(cwd, flag("current", "public/console"));
const captureAuditFile = path.resolve(cwd, flag("capture-audit", ".tmp/capture-audit.json"));
const outputFile = path.resolve(cwd, flag("output", ".tmp/screenshot-audit.json"));

async function readPngs(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((entry) => entry.endsWith(".png")).sort();
  } catch {
    return [];
  }
}

/** Raw RGBA plus dimensions. ensureAlpha so a PNG saved without one still compares. */
async function readFrame(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function readCaptureWarnings() {
  try {
    const parsed = JSON.parse(await fs.readFile(captureAuditFile, "utf8"));
    return Array.isArray(parsed.warnings) ? parsed.warnings : [];
  } catch {
    // No file means capture-console.mjs never reached the end. The capture job has already
    // failed in that case, so there is nothing here to hold back.
    return [];
  }
}

async function compare(name) {
  const currentFile = path.join(currentDir, name);
  const baselineFile = path.join(baselineDir, name);

  const current = await readFrame(currentFile);
  let baseline;
  try {
    baseline = await readFrame(baselineFile);
  } catch {
    return { name, kind: "new", changedRatio: null };
  }

  if (baseline.width !== current.width || baseline.height !== current.height) {
    return { name, kind: "resized", changedRatio: null };
  }

  return { name, kind: "changed", changedRatio: changedPixelRatio(baseline.data, current.data) };
}

async function main() {
  const names = await readPngs(currentDir);
  const warnings = await readCaptureWarnings();

  const all = [];
  for (const name of names) all.push(await compare(name));

  // An image that did not move is not part of the PR, so it is not part of the decision.
  const comparisons = all.filter((entry) => entry.kind !== "changed" || (entry.changedRatio ?? 0) > 0);
  const { verdict, reasons } = auditVerdict(comparisons, warnings);
  const table = formatComparisonTable(comparisons);

  const report = { verdict, reasons, comparisons, warnings };
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(table);
  console.log(`\nVerdict: ${verdict}`);
  for (const reason of reasons) console.log(`  - ${reason}`);

  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `verdict=${verdict}`,
      `table<<AUDIT_EOF\n${table}\nAUDIT_EOF`,
      `reasons<<AUDIT_EOF\n${reasons.map((reason) => `- ${reason}`).join("\n")}\nAUDIT_EOF`,
    ];
    await fs.appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, "utf8");
  }
}

await main();
