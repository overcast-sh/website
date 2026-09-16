import type { APIRoute } from "astro";
import { loadInstallScript } from "../lib/install-scripts-source";

// https://overcast.sh/install.ps1 — `irm https://overcast.sh/install.ps1 | iex`.
// The body is upstream's install/install.ps1 with this release's tag baked in; see
// src/lib/install-scripts.ts.
export const GET: APIRoute = async () =>
  new Response(await loadInstallScript("install.ps1"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
