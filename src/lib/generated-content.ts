import path from "node:path";
import fs from "node:fs/promises";

export type ServiceSupport = {
  service: string;
  displayName: string;
  totalOps: number;
  implementedOps: number;
  coverage: number;
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
    repo: "Neaox/overcast",
    sourceRef: "alpha",
    sourceRoot: "",
    brandingRoot: null,
    generatedAt: "",
    docsCount: 0,
    serviceCount: 0,
  });
}
