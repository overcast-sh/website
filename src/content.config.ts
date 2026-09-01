import { defineCollection, z } from "astro:content";
import { overcastReleaseSchema } from "./lib/release-schema";
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

// The release entry shape lives in src/lib/release-schema.ts, which the loader shares —
// see that file for why it can't be declared inline here.
const releases = defineCollection({
  loader: overcastReleasesLoader(),
  schema: overcastReleaseSchema,
});

export const collections = { docs, releases };
