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
