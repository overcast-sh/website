import { z } from "astro/zod";
import { changelogCategories } from "./changelog-parse";

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

/** Changelog categories, in the order `scripts/changelog.py assemble` emits them upstream.
 * Declared in changelog-parse.ts (which imports nothing, so it stays unit-testable) and
 * re-exported here, where the rest of the site already looks for the release vocabulary. */
export { changelogCategories };

export const changelogCategorySchema = z.enum(changelogCategories);

/** One bullet under a category heading: either parsed into its parts, or — when the bullet
 * doesn't match the fragment grammar — the markdown rendered as-is.
 *
 * The parsed shape mirrors the upstream fragment grammar line for line (see
 * src/lib/changelog-parse.ts): `summaryHtml` is the bullet's standalone first line,
 * `detailsHtml` holds each indented continuation line as its **own** rendered fragment — never
 * merged into one paragraph, which is what made a detailed entry a wall of text — and
 * `migrationHtml` is the `migration:` line a breaking entry carries.
 *
 * "raw" entries are pre-fragment-format bullets (`**Service** — prose`) and other unrecognized
 * content. A long one gets a lead/remainder split so it still has a scannable first line; see
 * splitLongEntryProse. */
export const changelogBulletEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("entry"),
      breaking: z.boolean(),
      areas: z.array(z.string()),
      summaryHtml: z.string(),
      detailsHtml: z.array(z.string()),
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
