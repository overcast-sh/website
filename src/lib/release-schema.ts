import { z } from "astro/zod";

// The single source of truth for the shape of a `releases` collection entry: the
// `releases` collection in src/content.config.ts validates with these schemas, and
// src/loaders/overcast-releases.ts builds its entries against the types inferred from
// them. Zod lives on this side of the wire (rather than the types being hand-written in
// the loader) because Astro's `defineCollection` needs a runtime schema and TypeScript
// can be derived from it, but not the other way around.
//
// Note the zod import: Astro types `defineCollection`'s schema against its own bundled
// zod 3 (`astro/zod`, the same instance `astro:content` re-exports), so these schemas
// cannot use the `zod4` alias the loader uses for the GitHub API response.
//
// Objects are `.strict()` so that a field the loader emits but never declares here fails
// the build instead of being quietly dropped from the collection.

/** Changelog categories, in the order `scripts/changelog.py assemble` emits them upstream. */
export const changelogCategories = ["added", "changed", "deprecated", "removed", "fixed", "security"] as const;

export const changelogCategorySchema = z.enum(changelogCategories);

/** One bullet under a category heading: either parsed into its parts, or — when the bullet
 * doesn't match the fragment grammar — the markdown rendered as-is.
 *
 * `proseHtml` is always what's shown up front; `proseMoreHtml` is a collapsed remainder (null
 * for a short entry, which renders exactly as `proseHtml` with nothing hidden). Same idea for
 * "raw" entries via `moreHtml` — a long pre-fragment-format bullet (`**Service** — prose`) gets
 * the identical lead/remainder split, just rendered through the raw markdown path instead of
 * the parsed one. See splitLongEntryProse in the loader. */
export const changelogBulletEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("entry"),
      breaking: z.boolean(),
      areas: z.array(z.string()),
      proseHtml: z.string(),
      proseMoreHtml: z.string().nullable(),
      proseText: z.string(),
      migrationHtml: z.string().nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("raw"), html: z.string(), moreHtml: z.string().nullable() }).strict(),
]);

/** One `### Heading` block: a recognized category with its entries, or unrecognized content
 * rendered as-is. */
export const changelogSectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("category"),
      category: changelogCategorySchema,
      label: z.string(),
      entries: z.array(changelogBulletEntrySchema),
    })
    .strict(),
  z.object({ kind: z.literal("raw"), html: z.string() }).strict(),
]);

export const overcastReleaseSchema = z
  .object({
    tagName: z.string(),
    name: z.string(),
    url: z.string(),
    publishedAt: z.string().nullable(),
    prerelease: z.boolean(),
    body: z.string(),
    summary: z.string(),
    changelogSections: z.array(changelogSectionSchema),
    assets: z.array(
      z
        .object({
          name: z.string(),
          size: z.number(),
          downloadUrl: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type ChangelogCategory = z.infer<typeof changelogCategorySchema>;
export type ChangelogBulletEntry = z.infer<typeof changelogBulletEntrySchema>;
export type ChangelogSection = z.infer<typeof changelogSectionSchema>;
export type OvercastReleaseData = z.infer<typeof overcastReleaseSchema>;
