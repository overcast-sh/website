import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import remarkGithubAlerts from "./src/plugins/remark-github-alerts";

export default defineConfig({
  site: "https://overcast.sh",
  // No `redirects` here: Astro's static redirect stub has no `<html>` element, so pagefind
  // warns on it. /compare/localstack/ redirects via src/pages/compare/localstack.astro.
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
