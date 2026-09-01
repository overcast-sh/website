import path from "node:path";
import fs from "node:fs/promises";

export type ServiceSupport = {
  service: string;
  // The doc page slug under docs/services/ for this service. Usually equal to `service`,
  // but a few upstream service ids (e.g. `elbv2`) don't match their doc's filename
  // (docs/services/elb.md) — use this for building `/docs/services/<docSlug>/` links
  // instead of assuming `service` always matches.
  docSlug: string;
  displayName: string;
  totalOps: number;
  implementedOps: number;
  coverage: number;
  coverageTier: string | null;
  operations: unknown[];
};

export type ServiceSupportManifest = {
  generatedBy: string | null;
  totalOps: number;
  implementedOps: number;
  services: ServiceSupport[];
};

export type SourceManifest = {
  repo: string;
  sourceRef: string;
  sourceRoot: string;
  brandingRoot: string | null;
  generatedAt: string;
  docsCount: number;
  serviceCount: number;
};

const generatedRoot = path.join(process.cwd(), "src", "generated");

async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(generatedRoot, fileName), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getServiceSupport(): Promise<ServiceSupportManifest> {
  return readJson<ServiceSupportManifest>("service-support.json", {
    generatedBy: null,
    totalOps: 0,
    implementedOps: 0,
    services: [],
  });
}

export function getSourceManifest(): Promise<SourceManifest> {
  return readJson<SourceManifest>("source-manifest.json", {
    repo: "overcast-sh/overcast",
    sourceRef: "",
    sourceRoot: "",
    brandingRoot: null,
    generatedAt: "",
    docsCount: 0,
    serviceCount: 0,
  });
}

// `coverageTier` comes straight from parsing upstream's generated service table (see
// scripts/sync-overcast-content.ts) and reads like internal engineering shorthand —
// "Comprehensive / broad support", "IaC/discovery-oriented stub". Anywhere this gets
// shown to a reader (the docs sidebar today; possibly the hub or support matrix later)
// should go through this map instead of rendering the raw string. Single source of
// truth so every caller stays in sync, with a safe fallback so an upstream tier we don't
// recognize yet (a new one added, wording tweaked) degrades to a readable title-cased
// string instead of breaking the build.
const COVERAGE_TIER_LABELS: Record<string, string> = {
  "Comprehensive / broad support": "Most complete",
  "Core CRUD + common workflows": "Core operations",
  "Minimal / targeted support": "Partial",
  "IaC/discovery-oriented stub": "Stubs for IaC",
};

function titleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/** Reader-facing label for a service's coverage tier. Pass the raw `coverageTier`
 * string (or null/undefined for a doc with no matching service). */
export function coverageTierLabel(tier: string | null | undefined): string {
  if (!tier) return "Other";
  return COVERAGE_TIER_LABELS[tier] ?? titleCase(tier);
}
