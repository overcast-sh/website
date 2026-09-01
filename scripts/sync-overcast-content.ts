import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repo = process.env.OVERCAST_REPO || "Neaox/overcast";
const sourceRef = process.env.OVERCAST_SOURCE_REF || process.env.OVERCAST_TRACKING_REF || "alpha";
const cwd = process.cwd();
const generatedDir = path.join(cwd, "src", "generated");
const obsoleteGeneratedDocsDir = path.join(generatedDir, "docs-html");
const obsoleteGeneratedDocsManifest = path.join(generatedDir, "docs-manifest.json");
const obsoleteGeneratedReleases = path.join(generatedDir, "releases.json");
const publicBrandDir = path.join(cwd, "public", "brand");
const publicFontsDir = path.join(cwd, "public", "fonts");

type ServiceSupport = {
  service: string;
  displayName: string;
  totalOps: number;
  implementedOps: number;
  coverage: number;
  operations: unknown[];
};

const publicDocFiles = [
  "README.md",
  "docs/README.md",
  "docs/sdk-cli.md",
  "docs/cdk.md",
  "docs/networking.md",
  "docs/storage.md",
  "docs/performance.md",
  "docs/migration-from-localstack.md",
];

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string, root = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute, root)));
    } else {
      files.push(normalizePath(path.relative(root, absolute)));
    }
  }
  return files;
}

async function resolveSourceRoot(): Promise<string> {
  const candidates = [
    process.env.OVERCAST_LOCAL_PATH,
    path.join(cwd, ".cache", "source", "overcast"),
    path.resolve(cwd, "..", "..", "overcast"),
  ].filter(isString);

  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "README.md"))) return path.resolve(candidate);
  }

  throw new Error(
    "Could not find Overcast source. Set OVERCAST_LOCAL_PATH, or checkout Neaox/overcast into .cache/source/overcast.",
  );
}

async function resolveBrandingRoot(): Promise<string | null> {
  const candidates = [
    process.env.OVERCAST_BRANDING_PATH,
    path.resolve(cwd, "..", "branding"),
  ].filter(isString);

  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "design-system", "tokens.css"))) return path.resolve(candidate);
  }

  return null;
}

function shouldPublishDoc(relativePath: string): boolean {
  const docPath = normalizePath(relativePath);
  if (!docPath.endsWith(".md")) return false;
  if (docPath.startsWith("docs/dev/") || docPath.startsWith("docs/plans/")) return false;
  if (publicDocFiles.includes(docPath)) return true;
  return docPath.startsWith("docs/cdk/") || docPath.startsWith("docs/services/");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonIfExists<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function countDocs(sourceRoot: string): Promise<number> {
  const docsRoot = path.join(sourceRoot, "docs");
  return [
    "README.md",
    ...((await exists(docsRoot)) ? (await walk(docsRoot)).map((file) => `docs/${file}`) : []),
  ].filter(shouldPublishDoc).length;
}

async function cleanupObsoleteGeneratedDocs(): Promise<void> {
  await fs.rm(obsoleteGeneratedDocsDir, { recursive: true, force: true });
  await fs.rm(obsoleteGeneratedDocsManifest, { force: true });
  await fs.rm(obsoleteGeneratedReleases, { force: true });
}

async function syncSupport(sourceRoot: string): Promise<ServiceSupport[]> {
  const supportPath = path.join(sourceRoot, "docs", "generated", "service-support.json");
  const raw = await readJsonIfExists<{
    generated_by?: string;
    total_ops?: number;
    services?: Array<{
      service: string;
      display_name: string;
      total_ops?: number;
      implemented_ops?: number;
      operations?: unknown[];
    }>;
  }>(supportPath, { total_ops: 0, services: [] });
  const services = (raw.services || []).map((service) => ({
    service: service.service,
    displayName: service.display_name,
    totalOps: service.total_ops || 0,
    implementedOps: service.implemented_ops || 0,
    coverage: service.total_ops ? Math.round(((service.implemented_ops || 0) / service.total_ops) * 100) : 0,
    operations: service.operations || [],
  }));

  await writeJson(path.join(generatedDir, "service-support.json"), {
    generatedBy: raw.generated_by || null,
    totalOps: raw.total_ops || services.reduce((sum, service) => sum + service.totalOps, 0),
    implementedOps: services.reduce((sum, service) => sum + service.implementedOps, 0),
    services,
  });
  return services;
}

async function copyFile(source: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function syncBranding(brandingRoot: string): Promise<void> {
  await fs.rm(publicBrandDir, { recursive: true, force: true });
  await fs.rm(publicFontsDir, { recursive: true, force: true });
  await fs.mkdir(publicBrandDir, { recursive: true });
  await fs.mkdir(publicFontsDir, { recursive: true });

  await copyFile(path.join(brandingRoot, "design-system", "tokens.css"), path.join(cwd, "src", "styles", "brand-tokens.css"));
  await copyFile(path.join(brandingRoot, "favicon", "favicon.svg"), path.join(publicBrandDir, "favicon.svg"));
  await copyFile(path.join(brandingRoot, "favicon", "favicon.ico"), path.join(publicBrandDir, "favicon.ico"));
  await copyFile(path.join(brandingRoot, "logo", "overcast-logo-light.svg"), path.join(publicBrandDir, "overcast-logo-light.svg"));
  await copyFile(path.join(brandingRoot, "logo", "overcast-logo-dark.svg"), path.join(publicBrandDir, "overcast-logo-dark.svg"));
  await copyFile(path.join(brandingRoot, "mark", "mark-light.svg"), path.join(publicBrandDir, "mark-light.svg"));
  await copyFile(path.join(brandingRoot, "mark", "mark-dark.svg"), path.join(publicBrandDir, "mark-dark.svg"));
  await copyFile(path.join(brandingRoot, "loading", "overcast-loader.svg"), path.join(publicBrandDir, "overcast-loader.svg"));
  await copyFile(path.join(brandingRoot, "social", "github-social-card.svg"), path.join(publicBrandDir, "github-social-card.svg"));
  await copyFile(path.join(brandingRoot, "fonts", "JetBrainsMono-Regular.ttf"), path.join(publicFontsDir, "JetBrainsMono-Regular.ttf"));
  await copyFile(path.join(brandingRoot, "fonts", "JetBrainsMono-Bold.ttf"), path.join(publicFontsDir, "JetBrainsMono-Bold.ttf"));
}

async function main() {
  const sourceRoot = await resolveSourceRoot();
  const brandingRoot = await resolveBrandingRoot();
  await fs.mkdir(generatedDir, { recursive: true });

  await cleanupObsoleteGeneratedDocs();
  if (brandingRoot) await syncBranding(brandingRoot);
  const docsCount = await countDocs(sourceRoot);
  const services = await syncSupport(sourceRoot);

  await writeJson(path.join(generatedDir, "source-manifest.json"), {
    repo,
    sourceRef,
    sourceRoot,
    brandingRoot,
    generatedAt: new Date().toISOString(),
    docsCount,
    serviceCount: services.length,
  });
}

await main();
