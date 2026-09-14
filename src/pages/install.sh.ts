import type { APIRoute } from "astro";
import { loadInstallScript } from "../lib/install-scripts-source";

// https://overcast.sh/install.sh — `curl -fsSL https://overcast.sh/install.sh | sh`.
// The body is upstream's install/install.sh with this release's tag baked in; see
// src/lib/install-scripts.ts. Served as text so it can be read in a browser where the host
// honours the header; GitHub Pages serves .sh as application/x-sh regardless, which curl
// does not care about.
export const GET: APIRoute = async () =>
  new Response(await loadInstallScript("install.sh"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
