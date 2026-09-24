/**
 * Build-time access to the synced compatibility reports (src/generated/compat/). The
 * pure helpers live in compat-report.ts; this file only reads, and caches, because every
 * service page and the explorer data route read the same few megabytes.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { getServiceSupport } from "./generated-content";
import type { CompatReport, CompatReportIndexEntry, ServiceNaming } from "./compat-report";

const compatRoot = path.join(process.cwd(), "src", "generated", "compat");

let indexPromise: Promise<CompatReportIndexEntry[]> | undefined;
const reportPromises = new Map<string, Promise<CompatReport | null>>();

/** Every synced release, newest first. Empty when no release has published a report yet. */
export function getCompatIndex(): Promise<CompatReportIndexEntry[]> {
  indexPromise ??= fs
    .readFile(path.join(compatRoot, "index.json"), "utf8")
    .then((raw) => JSON.parse(raw) as CompatReportIndexEntry[])
    .catch(() => []);
  return indexPromise;
}

export function getCompatReport(tag: string): Promise<CompatReport | null> {
  let promise = reportPromises.get(tag);
  if (!promise) {
    promise = fs
      .readFile(path.join(compatRoot, `${tag}.json`), "utf8")
      .then((raw) => JSON.parse(raw) as CompatReport)
      .catch(() => null);
    reportPromises.set(tag, promise);
  }
  return promise;
}

export interface CompatRelease {
  entry: CompatReportIndexEntry;
  report: CompatReport;
  /** The release before this one, for release-over-release changes. */
  previous: CompatReport | null;
}

/** A release and the one before it, by tag. */
export async function getCompatRelease(tag: string): Promise<CompatRelease | null> {
  const index = await getCompatIndex();
  const at = index.findIndex((entry) => entry.tag === tag);
  if (at < 0) return null;
  const report = await getCompatReport(tag);
  if (!report) return null;
  const previousEntry = index[at + 1];
  return { entry: index[at], report, previous: previousEntry ? await getCompatReport(previousEntry.tag) : null };
}

export async function getLatestCompatRelease(): Promise<CompatRelease | null> {
  const [latest] = await getCompatIndex();
  return latest ? getCompatRelease(latest.tag) : null;
}

/** Display names and doc links, from the support matrix the rest of the site uses. */
export async function getServiceNaming(): Promise<ServiceNaming> {
  const support = await getServiceSupport();
  return {
    displayNames: new Map(support.services.map((service) => [service.service, service.displayName])),
    docSlugs: new Map(support.services.map((service) => [service.service, service.docSlug ?? service.service])),
  };
}
