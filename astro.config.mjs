import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://overcast.sh",
  // /compare/localstack/ used to be a thin stub duplicating the real migration guide at
  // /docs/migration-from-localstack/ (see the content audit). A static-site redirect keeps
  // the URL developers expect resolving, without maintaining two pages for one guide.
  redirects: {
    "/compare/localstack/": "/docs/migration-from-localstack/",
  },
  markdown: {
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
