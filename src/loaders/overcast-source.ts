import fs from "node:fs/promises";
import path from "node:path";

export const overcastRepo = process.env.OVERCAST_REPO || "Neaox/overcast";
export const overcastSourceRef = process.env.OVERCAST_SOURCE_REF || process.env.OVERCAST_TRACKING_REF || "alpha";

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveOvercastSourceRoot(): Promise<string> {
  const cwd = process.cwd();
  const candidates = [
    process.env.OVERCAST_LOCAL_PATH,
    path.join(cwd, ".cache", "source", "overcast"),
    path.resolve(cwd, "..", "..", "overcast"),
  ].filter(isString);

  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "README.md"))) return path.resolve(candidate);
  }

  throw new Error(
    "Could not find Overcast source. Set OVERCAST_LOCAL_PATH or checkout Overcast into .cache/source/overcast.",
  );
}
