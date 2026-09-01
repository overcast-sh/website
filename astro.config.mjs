import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import remarkGithubAlerts from "./src/plugins/remark-github-alerts";

export default defineConfig({
  site: "https://overcast.sh",
  // /compare/localstack/ used to be a thin stub duplicating the real migration guide at
  // /docs/migration-from-localstack/ (see the content audit). A static-site redirect keeps
  // the URL developers expect resolving, without maintaining two pages for one guide.
  redirects: {
    "/compare/localstack/": "/docs/migration-from-localstack/",
  },
  markdown: {
    // Applies to every markdown the site renders: synced docs and release bodies both go
    // through the loader API's renderMarkdown(), which uses this config.
    remarkPlugins: [remarkGithubAlerts],
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
