import type { ChangelogBulletEntry, ChangelogCategory, ChangelogSection } from "../loaders/overcast-releases";

type ReleaseEntryLike = {
  data: {
    tagName: string;
    publishedAt: string | null;
    assets: readonly unknown[];
  };
};

/** Chip tone per changelog category. Removed and Security get the same "pay attention" tone
 * (Removed defaults to breaking upstream; Security is always worth a second look) — the brand
 * palette only carries a handful of semantic hues, so categories share rather than invent more. */
export const changelogCategoryTone: Record<ChangelogCategory, "accent" | "success" | "warning" | "danger" | "muted"> = {
  added: "success",
  changed: "accent",
  fixed: "muted",
  deprecated: "warning",
  removed: "danger",
  security: "danger",
};

export type FlatChangelogEntry = Extract<ChangelogBulletEntry, { kind: "entry" }> & {
  category: ChangelogCategory;
  label: string;
};

/** Flattens the first `limit` decorated (non-fallback) entries across a release's changelog
 * sections, in document order, for compact contexts like the downloads-page summary. Skips
 * "raw" fallback entries and raw sections entirely — those don't have areas/category to show. */
export function firstChangelogEntries(sections: readonly ChangelogSection[], limit = 3): FlatChangelogEntry[] {
  const flattened: FlatChangelogEntry[] = [];

  for (const section of sections) {
    if (section.kind !== "category") continue;
    for (const entry of section.entries) {
      if (entry.kind !== "entry") continue;
      flattened.push({ ...entry, category: section.category, label: section.label });
      if (flattened.length >= limit) return flattened;
    }
  }

  return flattened;
}

function releaseTime(release: ReleaseEntryLike): number {
  return release.data.publishedAt ? Date.parse(release.data.publishedAt) : 0;
}

export function sortReleasesNewestFirst<T extends ReleaseEntryLike>(releases: readonly T[]): T[] {
  return releases.toSorted((left, right) => {
    const timeDifference = releaseTime(right) - releaseTime(left);
    if (timeDifference !== 0) return timeDifference;

    return right.data.tagName.localeCompare(left.data.tagName, undefined, { numeric: true });
  });
}

export function newestReleaseWithAssets<T extends ReleaseEntryLike>(releases: readonly T[]): T | undefined {
  const sortedReleases = sortReleasesNewestFirst(releases);
  return sortedReleases.find((release) => release.data.assets.length > 0) ?? sortedReleases[0];
}
