import { defineCollection, z } from "astro:content";
import { overcastDocsLoader } from "./loaders/overcast-docs";
import { overcastReleasesLoader } from "./loaders/overcast-releases";

const docs = defineCollection({
  loader: overcastDocsLoader(),
  schema: z.object({
    sourcePath: z.string(),
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    section: z.string(),
    searchText: z.string(),
  }),
});

// Mirrors the `ChangelogBulletEntry` / `ChangelogSection` types in
// src/loaders/overcast-releases.ts — see that file for the parsing rules.
const changelogEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("entry"),
    breaking: z.boolean(),
    areas: z.array(z.string()),
    proseHtml: z.string(),
    proseText: z.string(),
    migrationHtml: z.string().nullable(),
  }),
  z.object({ kind: z.literal("raw"), html: z.string() }),
]);

const changelogSectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("category"),
    category: z.enum(["added", "changed", "deprecated", "removed", "fixed", "security"]),
    label: z.string(),
    entries: z.array(changelogEntrySchema),
  }),
  z.object({ kind: z.literal("raw"), html: z.string() }),
]);

const releases = defineCollection({
  loader: overcastReleasesLoader(),
  schema: z.object({
    tagName: z.string(),
    name: z.string(),
    url: z.string(),
    publishedAt: z.string().nullable(),
    prerelease: z.boolean(),
    body: z.string(),
    summary: z.string(),
    changelogSections: z.array(changelogSectionSchema),
    assets: z.array(
      z.object({
        name: z.string(),
        size: z.number(),
        downloadUrl: z.string(),
      }),
    ),
  }),
});

export const collections = { docs, releases };
