import type { ChangelogBulletEntry, ChangelogCategory, ChangelogSection } from "./release-schema";

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

const toneCssVar: Record<"accent" | "success" | "warning" | "danger" | "muted", string> = {
  accent: "--oc-accent",
  success: "--oc-success",
  warning: "--oc-warning",
  danger: "--oc-danger",
  muted: "--oc-muted",
};

/** The `--oc-*` custom property behind each category's tone, for styling entry rails/borders
 * directly rather than going through Chip. */
export const changelogCategoryCssVar: Record<ChangelogCategory, string> = Object.fromEntries(
  Object.entries(changelogCategoryTone).map(([category, tone]) => [category, toneCssVar[tone]]),
) as Record<ChangelogCategory, string>;

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

/** Pulls every breaking entry out of `sections` into its own flat, category-ordered list, and
 * returns the sections with those entries removed from their category — a breaking change is
 * surfaced once, pinned at the top of the release, not twice (once pinned, once buried in its
 * category). Non-category ("raw") sections pass through untouched. */
export function splitBreakingEntries(sections: readonly ChangelogSection[]): {
  breakingEntries: FlatChangelogEntry[];
  sections: ChangelogSection[];
} {
  const breakingEntries: FlatChangelogEntry[] = [];

  const nextSections = sections.map((section): ChangelogSection => {
    if (section.kind !== "category") return section;

    const remaining: ChangelogBulletEntry[] = [];
    for (const entry of section.entries) {
      if (entry.kind === "entry" && entry.breaking) {
        breakingEntries.push({ ...entry, category: section.category, label: section.label });
      } else {
        remaining.push(entry);
      }
    }
    return { ...section, entries: remaining };
  });

  return { breakingEntries, sections: nextSections };
}

export type ChangelogRollup = {
  /** Per-category entry counts, after breaking entries are pulled out (see splitBreakingEntries)
   * — this is what the category disclosure itself will actually contain, so the two numbers
   * never disagree. Categories with zero entries left are omitted. */
  counts: { category: ChangelogCategory; label: string; count: number }[];
  breakingCount: number;
  /** Every area referenced anywhere in the release (categories + breaking), deduplicated in
   * first-seen order. */
  areas: string[];
};

/** Release-wide rollup for triage: "12 added · 8 fixed · 2 breaking" plus the areas touched.
 * Null when the release has no recognized category section at all (old-format body, nothing
 * honest to roll up) — the caller falls back to showing nothing, never a fake "0 added". */
export function changelogRollup(sections: readonly ChangelogSection[]): ChangelogRollup | null {
  const hasCategory = sections.some((section) => section.kind === "category");
  if (!hasCategory) return null;

  const { breakingEntries, sections: nonBreakingSections } = splitBreakingEntries(sections);

  const counts = nonBreakingSections
    .filter((section): section is Extract<ChangelogSection, { kind: "category" }> => section.kind === "category")
    .map((section) => ({ category: section.category, label: section.label, count: section.entries.length }))
    .filter((entry) => entry.count > 0);

  const areas: string[] = [];
  const seenAreas = new Set<string>();
  for (const section of sections) {
    if (section.kind !== "category") continue;
    for (const entry of section.entries) {
      if (entry.kind !== "entry") continue;
      for (const area of entry.areas) {
        if (seenAreas.has(area)) continue;
        seenAreas.add(area);
        areas.push(area);
      }
    }
  }

  return { counts, breakingCount: breakingEntries.length, areas };
}

/** Caps an area list for a space-constrained, non-interactive context (the collapsed-accordion
 * summary line) — the full, uncapped list is what the open release's filter chips show, since
 * every area has to stay clickable there. */
export function cappedAreas(areas: readonly string[], limit: number): { shown: string[]; more: number } {
  if (areas.length <= limit) return { shown: [...areas], more: 0 };
  return { shown: areas.slice(0, limit), more: areas.length - limit };
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
