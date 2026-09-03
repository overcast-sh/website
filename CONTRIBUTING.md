# Contributing

Thanks for your interest in the Overcast website.

## Before you file a docs PR here

**Documentation content lives in [`overcast-sh/overcast`](https://github.com/overcast-sh/overcast), not in this repo.**
This site pulls its docs from that repo at build time and never commits copied content —
`src/generated/` is gitignored and rebuilt by `npm run content:sync`. The "Edit this page"
links on every docs page point back to `overcast-sh/overcast`, which is where corrections,
new pages, and content edits belong. PRs here that only change doc wording will be
redirected there.

## What belongs in this repo

- Page layout and navigation (`src/pages/`, `src/components/`)
- Styling and design (`src/styles/`, Tailwind config)
- The content-sync and build pipeline (`scripts/`, `src/loaders/`, `src/lib/`)
- Non-docs pages: home, downloads, releases, support, compare

## Dev setup

See [README.md](./README.md) for full local setup, including how to point
`OVERCAST_LOCAL_PATH` at a local `overcast-sh/overcast` checkout (required) and the
optional `OVERCAST_BRANDING_PATH`. Quick start:

```powershell
$env:OVERCAST_LOCAL_PATH = "C:\path\to\overcast"
npm install
npm run dev
```

Node 24 and npm are required.

## Before submitting a PR

Run these and make sure both succeed:

```
npm run check
npm run build
```

`npm run check` starts with `npm run copy-lint` (`scripts/copy-lint.mjs`, also the
`copy-lint` CI job), which greps the hand-written page copy for contrastive "X, not Y"
framing, marketing vocabulary, rhetorical questions and US spelling — record a deliberate
use in that script's `ALLOW` list or with a `copy-lint-ignore <rule>` comment.

`npm run build` runs the content sync and pagefind search indexing, so it needs
`OVERCAST_LOCAL_PATH` set to a valid local checkout.

Keep PRs focused — avoid mixing unrelated layout/styling changes with build pipeline
changes. Describe what changed and why in the PR description.
