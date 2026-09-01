import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import remarkGithubAlerts from "./src/plugins/remark-github-alerts";
import rehypeTableA11y from "./src/plugins/rehype-table-a11y";

export default defineConfig({
  site: "https://overcast.sh",
  // No `redirects` here: Astro's static redirect stub has no `<html>` element, so pagefind
  // warns on it. /compare/localstack/ redirects via src/pages/compare/localstack.astro.
  markdown: {
    // Applies to every markdown the site renders: synced docs and release bodies both go
    // through the loader API's renderMarkdown(), which uses this config.
    remarkPlugins: [remarkGithubAlerts],
    rehypePlugins: [rehypeTableA11y],
    shikiConfig: {
      themes: {
        light: "github-light",
        // github-dark is tuned for GitHub's near-black #0d1117; the site paints code
        // blocks on --oc-card, which is lighter, and its comment and punctuation
        // tokens land at 3.3-3.5:1 there. github-dark-default is the same palette
        // pitched brighter and clears 4.5:1 on this surface.
        dark: "github-dark-default",
      },
      defaultColor: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
