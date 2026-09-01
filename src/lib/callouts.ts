/**
 * The callout/admonition primitive's shared definition — one kind table behind two
 * renderers: `src/components/Callout.astro` (hand-authored pages) and
 * `src/plugins/remark-github-alerts.ts` (GitHub `> [!NOTE]` alerts in synced markdown).
 * Both must look identical, so label, colour token and glyph live here once.
 *
 * The five kinds are GitHub's alert set. Colour comes from the semantic tokens only
 * (`--oc-accent` / `--oc-success` / `--oc-warning` / `--oc-danger`) — the categorical
 * ramp is reserved for service identity. That set has four colours for five kinds:
 * note and important share the accent and are told apart by glyph and label, which is
 * also how GitHub's own two blue-ish kinds read.
 *
 * Glyph geometry is copied from `@lucide/astro`'s icon modules (same `[tag, attrs]`
 * shape they use internally) rather than imported: the remark plugin runs inside the
 * markdown pipeline, where an `.astro` component can't be rendered.
 */

type IconNode = readonly (readonly [string, Record<string, string>])[];

const INFO: IconNode = [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["path", { d: "M12 16v-4" }],
  ["path", { d: "M12 8h.01" }],
];

const LIGHTBULB: IconNode = [
  ["path", { d: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" }],
  ["path", { d: "M9 18h6" }],
  ["path", { d: "M10 22h4" }],
];

const MESSAGE_SQUARE_WARNING: IconNode = [
  ["path", { d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" }],
  ["path", { d: "M12 15h.01" }],
  ["path", { d: "M12 7v4" }],
];

const TRIANGLE_ALERT: IconNode = [
  ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
  ["path", { d: "M12 9v4" }],
  ["path", { d: "M12 17h.01" }],
];

const OCTAGON_ALERT: IconNode = [
  ["path", { d: "M12 16h.01" }],
  ["path", { d: "M12 8v4" }],
  ["path", { d: "M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" }],
];

export const calloutKinds = {
  note: { label: "Note", icon: INFO },
  tip: { label: "Tip", icon: LIGHTBULB },
  important: { label: "Important", icon: MESSAGE_SQUARE_WARNING },
  warning: { label: "Warning", icon: TRIANGLE_ALERT },
  caution: { label: "Caution", icon: OCTAGON_ALERT },
} as const satisfies Record<string, { label: string; icon: IconNode }>;

export type CalloutKind = keyof typeof calloutKinds;

export function isCalloutKind(value: string): value is CalloutKind {
  return value in calloutKinds;
}

const SVG_ATTRIBUTES: Record<string, string> = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.75",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
};

/** The glyph as an SVG string, for `set:html` in an Astro component. */
export function calloutIconSvg(kind: CalloutKind, className = "callout-icon"): string {
  const attrs = Object.entries({ ...SVG_ATTRIBUTES, class: className })
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
  const children = calloutKinds[kind].icon
    .map(([tag, tagAttrs]) => {
      const serialized = Object.entries(tagAttrs)
        .map(([name, value]) => `${name}="${value}"`)
        .join(" ");
      return `<${tag} ${serialized}/>`;
    })
    .join("");
  return `<svg ${attrs}>${children}</svg>`;
}

/** The same glyph as hast, for a remark/rehype node's `hProperties`/`hChildren`. */
export function calloutIconHast(kind: CalloutKind, className = "callout-icon") {
  return {
    properties: { ...SVG_ATTRIBUTES, class: className },
    children: calloutKinds[kind].icon.map(([tagName, properties]) => ({
      type: "element" as const,
      tagName,
      properties: { ...properties },
      children: [],
    })),
  };
}
