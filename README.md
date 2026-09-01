<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://overcast.sh/brand/overcast-logo-dark.svg">
    <img alt="Overcast" src="https://overcast.sh/brand/overcast-logo-light.svg" width="360">
  </picture>
</p>
<p align="center"><em>The overcast.sh website.</em></p>

# Overcast website

Static product and documentation website for Overcast.

## Local development

The website pulls public documentation from an Overcast source checkout at build time. It does not commit copied
Overcast docs.

```powershell
$env:OVERCAST_LOCAL_PATH = "C:\path\to\overcast"
$env:OVERCAST_BRANDING_PATH = "C:\path\to\branding"
npm install
npm run dev
```

`OVERCAST_LOCAL_PATH` is the only required local input once dependencies are installed. When
`OVERCAST_BRANDING_PATH` is present, the build refreshes the copied branding assets from that repo.
On macOS or Linux, use the equivalent absolute paths for your local checkouts.

GitHub links are configurable:

- `OVERCAST_REPO` controls the project repository and release API source.
- `OVERCAST_EDIT_REF` controls docs "Edit this page" links back to the Overcast repo.
- `WEBSITE_REPO` controls website page edit links.
- `WEBSITE_EDIT_REF` controls the website branch used for edit links.
- `EDIT_LINK_MODE` controls edit link behavior: `auto` uses VS Code links during `astro dev` and GitHub links in
  production builds; `github` or `vscode` force either mode.

## Content lifecycle

- Website source changes on `main` build and deploy the site to GitHub Pages.
- Overcast release events can trigger this repo with `repository_dispatch` type `overcast-release`.
- Manual builds can provide `source_ref`.
- Absent a manual `source_ref` or dispatch tag, builds resolve the latest Overcast release via the GitHub API.
- Scheduled runs resolve the latest release and stop before build/deploy when it matches the last deployed release
  (tracked in `.github/overcast-release.lock`).

## Console screenshots

`public/console/*.png` is captured automatically by `.github/workflows/refresh-screenshots.yml`.

- It runs on `repository_dispatch` (`overcast-release`), weekly on Mondays, and on manual dispatch.
- Each run fingerprints the `web/` tree of the latest Overcast release and stops early when that matches
  `.github/console-ui.lock`. Manual runs always capture.
- Capture boots `ghcr.io/overcast-sh/overcast:latest`, deploys the `overcast-sh/examples` CDK stacks into it,
  then drives the console with `scripts/capture-console.mjs` (Playwright).
- Changed images arrive as a `screenshots/refresh-<tag>` pull request; nothing is pushed to `main` directly.
- That PR needs the `RELEASE_APP_CLIENT_ID` / `RELEASE_APP_PRIVATE_KEY` App secrets to run required
  checks; without them it is authored by `github-actions` and checks never start.
- To run it by hand: Actions → "Refresh console screenshots" → Run workflow.

## Generated content

One command regenerates everything a script owns:

```powershell
npm run content:sync
```

`predev` and `prebuild` already run it, so `npm run dev` / `npm run build` need nothing extra.

What it writes, and whether git tracks it:

| Output | Tracked | Why |
| --- | --- | --- |
| `src/generated/` | no | Derived from the Overcast checkout on every build; carries a `generatedAt` stamp, so tracking it would churn on every run. |
| `dist/`, `.astro/` | no | Build output, including the pagefind index. |
| `designs/` | no | Local reference material only. |
| `src/styles/brand-tokens.css`, `public/brand/*`, `public/fonts/*` | **yes** | Vendored from [`overcast-sh/branding`](https://github.com/overcast-sh/branding). The deploy workflow doesn't check that repo out, so the site could not render without the committed copies. |

Because the brand assets are a copy of someone else's file, `npm run content:check` compares
them against a branding checkout and fails on drift; the `brand-drift` CI job runs it on every
PR. To take an update: set `OVERCAST_BRANDING_PATH`, run `npm run content:sync`, commit.

`src/styles/brand-tokens.css` is overwritten byte-for-byte by that sync. **Site-only tokens go in
`src/styles/site-tokens.css`**, which the sync never touches. Everything else under `public/brand`
(notably `social-card.png`, the Open Graph image) is site-owned and likewise left alone.

Published docs exclude internal planning and contributor-only areas:

- `docs/dev/**`
- `docs/plans/**`
