// Copy lint for site-authored prose.
//
// The pages in this repo are written by hand, and the failure mode they keep drifting
// towards is house-style LLM copy: "not a X, but a Y", "seamlessly", "unlock", a
// rhetorical question answered by the next sentence. This script greps the prose the
// site actually publishes — visible text plus the string literals the templates render
// from — and fails on those shapes so they stay out.
//
// It only reads text: HTML tags, class attributes, <script>/<style> bodies and code
// comments are stripped first, so `items-center` is not a US spelling and a comment
// explaining a decision is not site copy.
//
// Run: node scripts/copy-lint.mjs [--list]
//   --list prints every hit without failing (used when auditing).
//
// A deliberate use goes in ALLOW below with a reason, or gets a
// `copy-lint-ignore <rule>` comment on the line above it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["src/pages", "src/components"];

/** @type {{id: string, re: RegExp, hint: string}[]} */
const RULES = [
  {
    id: "contrastive",
    re: /(?:,|—|--)\s*not\s+(?!only\b)\w|\b(?:is|are|was|were|it'?s|they'?re)\s+not\s+(?:a|an|the)\b[^.!?]{0,80}?(?:—|--|,)\s*(?:but|it'?s|they'?re|rather)|\b(?:isn'?t|aren'?t)\b[^.!?]{0,60}?(?:—|--)\s*(?:it'?s|they'?re)\b|\bit'?s not about\b/i,
    hint: 'contrastive framing ("X, not Y" / "isn\'t X — it\'s Y"). Say what the thing is.',
  },
  {
    id: "whether-youre",
    re: /\bwhether you'?(?:re|ll|d)\b/i,
    hint: '"whether you\'re a … or a …". Name the reader once, or drop the sentence.',
  },
  {
    id: "vocab",
    re: /\b(?:seamless(?:ly)?|delve[sd]?|delving|unlocks?|unlocked|unlocking|empowers?|empowered|empowering|elevates?|elevated|elevating|robust(?:ly)?|leverages?|leveraged|leveraging|effortless(?:ly)?|supercharges?|cutting[- ]edge|best[- ]in[- ]class|game[- ]chang\w*|revolutionis\w*|revolutioniz\w*|unleash\w*|world[- ]class|streamlin\w*|holistic|synerg\w*|paradigm|blazing(?:ly)?[- ]fast|in today'?s\b|at the end of the day\b|deep[- ]dive|dives? into\b|it'?s worth noting\b|needless to say\b)/i,
    hint: "marketing vocabulary. Use the plain verb for what happens.",
  },
  {
    // `\w?` deliberately: prose puts the question mark against the word ("Stuck? Read
    // this"), JavaScript puts a space in front of a ternary and a dot after an optional
    // chain, so neither is mistaken for a question.
    id: "rhetorical",
    re: /\w\?["”']?(?:\s+[A-Z(]|\s*$)/,
    hint: "rhetorical question. Lead with the answer.",
  },
  {
    id: "adjective-triad",
    re: /\b(?:a|an|the)\s+[a-z]+(?:-[a-z]+)?,\s+[a-z]+(?:-[a-z]+)?,\s+(?:and\s+)?[a-z]+(?:-[a-z]+)?\s+[a-z]/i,
    hint: "stacked adjectives. Keep the one that carries information.",
  },
  {
    id: "em-dash-pile",
    re: /—[^—]*—[^—]*—/,
    hint: "three or more em dashes in one line. Use full stops.",
  },
  {
    id: "spelling",
    re: /\b(?:behaviors?|behavioral|colors?|colored|analyze[srd]?|analyzing|customiz\w+|organiz\w+|catalogs?|traveling|modeling|fulfill\w*)\b/i,
    hint: "US spelling. This site is written in British English.",
  },
];

/**
 * Deliberate uses. Matched as a substring of the offending line, so they survive
 * the line moving.
 * @type {{rule: string, phrase: string, why: string}[]}
 */
const ALLOW = [
  {
    rule: "rhetorical",
    phrase: "Filter services…",
    why: "input placeholder, not prose",
  },
];

const listOnly = process.argv.includes("--list");

/** Replace a match with its own newlines, so line numbers survive stripping. */
const blank = (match) => match.replace(/[^\n]/g, "");

/**
 * Frontmatter is JavaScript. The prose in it lives in string literals (a feature card's
 * `body`, a default prop), so keep those and blank everything else — imports, paths and
 * identifiers included, or `service-catalog` reads as a US spelling.
 */
function frontmatterProse(front) {
  const withoutCode = front
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (match, prefix) => prefix + blank(match.slice(prefix.length)))
    .replace(/^\s*(?:import|export)\b[^;\n]*;?/gm, blank);

  const out = withoutCode.split("");
  for (let i = 0; i < out.length; i += 1) if (out[i] !== "\n") out[i] = " ";

  const literal = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  let match;
  while ((match = literal.exec(withoutCode)) !== null) {
    const value = match[2];
    // Prose has spaces in it; a path, URL or class list is not prose.
    if (!/\s/.test(value) || /^[./]|:\/\//.test(value)) continue;
    const start = match.index + 1;
    for (let i = 0; i < value.length; i += 1) if (value[i] !== "\n") out[start + i] = value[i];
  }
  return out.join("");
}

function proseOf(source, file) {
  const isAstro = file.endsWith(".astro");
  let text = source;

  if (isAstro) {
    const fence = /^---\r?\n([\s\S]*?)\r?\n---/;
    const match = text.match(fence);
    if (match) {
      text = text.slice(0, match.index) + "---\n" + frontmatterProse(match[1]) + "\n---" + text.slice(match.index + match[0].length);
    }
  }

  const withoutCode = text
    .replace(/<script[\s\S]*?<\/script>/gi, blank)
    .replace(/<style[\s\S]*?<\/style>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank);

  const lines = withoutCode.replace(/<[^>]*>/g, blank).split("\n");

  // Stripping tags would take the prose that lives in an attribute with them — alt text,
  // an aria-label on a diagram, a label passed to a component — so those come back.
  const attribute = /\b(?:alt|title|label|aria-label|placeholder|description|searchTitle)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = attribute.exec(withoutCode)) !== null) {
    const line = withoutCode.slice(0, match.index).split("\n").length - 1;
    lines[line] = `${lines[line] ?? ""} ${match[1]}`;
  }

  return lines;
}

function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.name.endsWith(".astro")) out.push(full);
  }
  return out;
}

const hits = [];
for (const dir of roots) {
  for (const file of collectFiles(path.join(root, dir))) {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    const source = fs.readFileSync(file, "utf8");
    const rawLines = source.split("\n");
    const lines = proseOf(source, relative);

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const previous = (rawLines[index - 1] ?? "") + (rawLines[index - 2] ?? "");

      for (const rule of RULES) {
        const match = trimmed.match(rule.re);
        if (!match) continue;
        if (previous.includes(`copy-lint-ignore ${rule.id}`)) continue;
        if (ALLOW.some((entry) => entry.rule === rule.id && trimmed.includes(entry.phrase))) continue;
        hits.push({ file: relative, line: index + 1, rule: rule.id, hint: rule.hint, text: trimmed.slice(0, 140) });
      }
    });
  }
}

if (hits.length === 0) {
  console.log(`copy-lint: no hits in ${roots.join(", ")}.`);
  process.exit(0);
}

for (const hit of hits) {
  console.log(`${hit.file}:${hit.line}  [${hit.rule}] ${hit.text}`);
  console.log(`  ↳ ${hit.hint}`);
}
console.log(`\ncopy-lint: ${hits.length} hit${hits.length === 1 ? "" : "s"}.`);
console.log("Rewrite the line, or record a deliberate use in scripts/copy-lint.mjs (ALLOW) or with a");
console.log("`copy-lint-ignore <rule>` comment above it.");
process.exit(listOnly ? 0 : 1);
