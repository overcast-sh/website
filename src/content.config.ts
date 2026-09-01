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
