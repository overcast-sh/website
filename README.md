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

## Generated content

`src/generated/` is ignored and rebuilt by `npm run content:sync`.

`designs/` is treated as local reference material and is intentionally ignored by git.

Published docs exclude internal planning and contributor-only areas:

- `docs/dev/**`
- `docs/plans/**`
