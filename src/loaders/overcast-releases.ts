import type { Loader } from "astro/loaders";
import { z } from "zod4";
import { overcastRepo } from "./overcast-source";
import { rewriteLegacyOrgReferences } from "../lib/github-links";

export type OvercastReleaseData = {
  tagName: string;
  name: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
  body: string;
  summary: string;
  assets: Array<{
    name: string;
    size: number;
    downloadUrl: string;
  }>;
};

const githubReleaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  html_url: z.url(),
  published_at: z.string().nullable(),
  prerelease: z.boolean(),
  body: z.string().nullable(),
  assets: z.array(
    z.object({
      name: z.string(),
      size: z.number(),
      browser_download_url: z.url(),
    }),
  ),
});

const githubReleasesSchema = z.array(githubReleaseSchema);

const summaryCharacterLimit = 360;
const boilerplateHeadings = new Set(["docker images", "native binaries"]);

function cleanInlineMarkdown(markdown: string): string {
  return markdown
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtSentence(text: string): string {
  if (text.length <= summaryCharacterLimit) return text;

  const sliced = text.slice(0, summaryCharacterLimit).trim();
  const sentenceEnd = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf("; "), sliced.lastIndexOf(": "));
  if (sentenceEnd > summaryCharacterLimit * 0.55) return `${sliced.slice(0, sentenceEnd + 1).trim()}...`;

  const wordEnd = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, wordEnd > 0 ? wordEnd : summaryCharacterLimit).trim()}...`;
}

function releaseNotesSection(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const releaseNotesStart = lines.findIndex((line) => /^#{1,6}\s+release notes\s*$/i.test(line.trim()));
  return releaseNotesStart >= 0 ? lines.slice(releaseNotesStart + 1) : lines;
}

function extractSummaryNodes(markdown: string): string[] {
  const nodes: string[] = [];
  const paragraph: string[] = [];
  let currentHeading = "";
  let inFence = false;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const text = cleanInlineMarkdown(paragraph.join(" "));
    paragraph.length = 0;
    if (text) nodes.push(text);
  }

  for (const rawLine of releaseNotesSection(markdown)) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      inFence = !inFence;
      flushParagraph();
      continue;
    }
    if (inFence) continue;

    if (!line) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      currentHeading = cleanInlineMarkdown(heading[1]).replace(/:$/, "");
      continue;
    }

    if (boilerplateHeadings.has(currentHeading.toLowerCase())) continue;
    if (/^\|.*\|$/.test(line) || /^[-:\s|]+$/.test(line)) continue;
    if (/^(pull|channel tag|registry|download a binary|asset|sha256|docker run)\b/i.test(line)) continue;

    const listItem = line.match(/^[-*+]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      const text = cleanInlineMarkdown(listItem[1]);
      if (text) nodes.push(currentHeading ? `${currentHeading}: ${text}` : text);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return nodes;
}

function summarizeMarkdown(markdown: string): string {
  const nodes = extractSummaryNodes(markdown);
  return truncateAtSentence(nodes.slice(0, 3).join(" "));
}

async function fetchGitHubReleases(): Promise<OvercastReleaseData[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${overcastRepo}/releases`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (process.env.CI) throw error;
    return [];
  }

  if (!response.ok) {
    const message = `GitHub releases request failed with ${response.status} ${response.statusText}`;
    if (process.env.CI) throw new Error(message);
    return [];
  }

  const data = githubReleasesSchema.parse(await response.json());
  return data.slice(0, 30).map((release) => {
    // Old release bodies reference the pre-rename `Neaox` GitHub org / `ghcr.io/neaox`
    // image namespace. Those releases will never be edited upstream, so rewrite the
    // stale org references before summarizing/rendering, so both the raw body and the
    // rendered markdown are clean.
    const body = rewriteLegacyOrgReferences(release.body || "");
    return {
      tagName: release.tag_name,
      name: release.name || release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at,
      prerelease: release.prerelease,
      body,
      summary: summarizeMarkdown(body),
      assets: (release.assets || []).map((asset) => ({
        name: asset.name,
        size: asset.size,
        downloadUrl: asset.browser_download_url,
      })),
    };
  });
}

export function overcastReleasesLoader(): Loader {
  return {
    name: "overcast-releases",
    async load({ store, parseData, renderMarkdown, generateDigest }) {
      const releases = await fetchGitHubReleases();

      store.clear();
      for (const release of releases) {
        const data = await parseData({
          id: release.tagName,
          data: release satisfies OvercastReleaseData,
        });
        store.set({
          id: release.tagName,
          data,
          rendered: await renderMarkdown(release.body),
          digest: generateDigest(JSON.stringify(release)),
        });
      }
    },
  };
}
