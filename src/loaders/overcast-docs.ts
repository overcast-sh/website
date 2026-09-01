import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { Loader } from "astro/loaders";
import { exists, resolveOvercastSourceRoot } from "./overcast-source";

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

export type OvercastDocData = {
  sourcePath: string;
  slug: string;
  title: string;
  description: string;
  section: string;
  searchText: string;
};

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

async function walk(dir: string, root = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
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

function shouldPublishDoc(relativePath: string): boolean {
  const docPath = normalizePath(relativePath);
  if (!docPath.endsWith(".md")) return false;
  if (docPath.startsWith("docs/dev/") || docPath.startsWith("docs/plans/")) return false;
  if (publicDocFiles.includes(docPath)) return true;
  return docPath.startsWith("docs/cdk/") || docPath.startsWith("docs/services/");
}

function titleFromPath(docPath: string): string {
  const name = docPath.split("/").pop()?.replace(/\.md$/, "") || "Documentation";
  if (name.toLowerCase() === "readme") return docPath === "README.md" ? "Overview" : "Documentation";
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function sectionFor(docPath: string, frontmatter: Record<string, unknown>): string {
  if (frontmatter.section) return String(frontmatter.section);
  if (docPath === "README.md") return "Overview";
  if (docPath.startsWith("docs/services/")) return "Services";
  if (docPath.startsWith("docs/cdk")) return "CDK";
  return "Guides";
}

function slugFor(docPath: string): string {
  if (docPath === "README.md") return "docs/overview";
  if (docPath === "docs/README.md") return "docs";
  if (docPath === "docs/cdk/README.md") return "docs/cdk/overview";
  return docPath.replace(/^docs\//, "docs/").replace(/README\.md$/, "").replace(/\.md$/, "");
}

function rewriteMarkdownLinks(markdown: string): string {
  return markdown.replace(/\]\((?!https?:|mailto:|#)([^)]+\.md)(#[^)]+)?\)/g, (_, target: string, hash = "") => {
    const normalized = normalizePath(target);
    const clean = normalized.replace(/^\.\//, "");
    const slug = clean.startsWith("docs/") ? slugFor(clean) : slugFor(`docs/${clean}`);
    return `](/${slug}/${hash})`;
  });
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let backtickRun = 0;
  let escaped = false;

  for (const character of trimmed) {
    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      cell += character;
      escaped = true;
      continue;
    }

    if (character === "`") {
      backtickRun = backtickRun === 0 ? 1 : 0;
      cell += character;
      continue;
    }

    if (character === "|" && backtickRun === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());
  return cells;
}

function tableRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function tableDelimiter(columnCount: number): string {
  return tableRow(Array.from({ length: columnCount }, () => "---"));
}

function normalizeTableBlock(block: readonly string[]): string[] {
  if (block.length < 2) return [...block];

  const columnCount = tableCells(block[0]).length;
  if (columnCount === 0) return [...block];

  const rows = [block[0], tableDelimiter(columnCount)];

  for (const line of block.slice(2)) {
    const cells = tableCells(line);
    if (cells.length <= columnCount) {
      rows.push(tableRow([...cells, ...Array.from({ length: columnCount - cells.length }, () => "")]));
      continue;
    }

    if (columnCount === 2) {
      const firstRow = cells.slice(0, 2);
      const remaining = cells.slice(2).filter((cell) => cell.length > 0);
      rows.push(tableRow(firstRow));
      for (let index = 0; index < remaining.length; index += 2) {
        rows.push(tableRow([remaining[index] ?? "", remaining[index + 1] ?? ""]));
      }
      continue;
    }

    rows.push(tableRow(cells.slice(0, columnCount)));
  }

  return rows;
}

function normalizeMarkdownTables(markdown: string): string {
  const normalized: string[] = [];
  const tableBlock: string[] = [];

  function flushTable() {
    if (tableBlock.length === 0) return;
    normalized.push(...normalizeTableBlock(tableBlock));
    tableBlock.length = 0;
  }

  for (const line of markdown.split("\n")) {
    if (isTableLine(line)) {
      tableBlock.push(line);
      continue;
    }

    flushTable();
    normalized.push(line);
  }

  flushTable();
  return normalized.join("\n");
}

export function overcastDocsLoader(): Loader {
  return {
    name: "overcast-docs",
    async load({ store, parseData, renderMarkdown, generateDigest }) {
      const sourceRoot = await resolveOvercastSourceRoot();
      const docsRoot = path.join(sourceRoot, "docs");
      const docPaths = [
        "README.md",
        ...((await exists(docsRoot)) ? (await walk(docsRoot)).map((file) => `docs/${file}`) : []),
      ]
        .filter(shouldPublishDoc)
        .sort();

      store.clear();

      for (const sourcePath of docPaths) {
        const absolute = path.join(sourceRoot, sourcePath);
        const raw = await fs.readFile(absolute, "utf8");
        const parsed = matter(raw);
        const title = String(parsed.data.title || titleFromPath(sourcePath));
        const description = String(parsed.data.description || "");
        const slug = slugFor(sourcePath).replace(/\/$/, "");
        const body = normalizeMarkdownTables(rewriteMarkdownLinks(parsed.content));
        const data = await parseData({
          id: slug,
          data: {
            sourcePath,
            slug,
            title,
            description,
            section: sectionFor(sourcePath, parsed.data),
            searchText: `${title} ${description} ${body}`.toLowerCase(),
          } satisfies OvercastDocData,
        });

        store.set({
          id: slug,
          data,
          rendered: await renderMarkdown(body),
          digest: generateDigest(`${sourcePath}\n${raw}`),
        });
      }
    },
  };
}
