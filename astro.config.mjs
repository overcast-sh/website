import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import remarkGithubAlerts from "./src/plugins/remark-github-alerts";
import rehypeMarkdownA11y from "./src/plugins/rehype-markdown-a11y";

export default defineConfig({
  site: "https://overcast.sh",
  // No `redirects` here: Astro's static redirect stub has no `<html>` element, so pagefind
  // warns on it. /compare/localstack/ redirects via src/pages/compare/localstack.astro.
  markdown: {
    // Applies to every markdown the site renders: synced docs and release bodies both go
    // through the loader API's renderMarkdown(), which uses this config.
    remarkPlugins: [remarkGithubAlerts],
    rehypePlugins: [rehypeMarkdownA11y],
    shikiConfig: {
      themes: {
        // GitHub's current pair rather than the legacy `github-light`/`github-dark`.
        // The legacy two both carry tokens that fail on this site's code surface:
        // github-light's parameter orange lands at 3.5:1 on --oc-card, and
        // github-dark is tuned for GitHub's near-black #0d1117 while the site paints
        // code on the lighter --oc-card, which drops its comments to 3.3:1. The
        // `-default` pair is the same palette re-tuned and clears 4.5:1 on both.
        light: "github-light-default",
        dark: "github-dark-default",
      },
      defaultColor: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
