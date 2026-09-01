/**
 * Renders GitHub-style alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`,
 * `[!CAUTION]`) as the site's own callout, so an alert written upstream in the Overcast
 * docs — or in a release body — reads exactly like a hand-authored `<Callout>` on the
 * rest of the site. Shape and styling come from src/lib/callouts.ts + the `.callout`
 * rules in src/styles/global.css; this file only rewrites the tree.
 *
 * Written here rather than pulled in as a package because the whole job is ~40 lines and
 * every published plugin ships its own class names and stylesheet to override — which is
 * more code to reconcile than the transform itself.
 *
 * A blockquote whose first line isn't an alert marker is left completely untouched and
 * still renders as a blockquote.
 */
import { calloutIconHast, calloutKinds, isCalloutKind } from "../lib/callouts";

// The marker must be alone on the blockquote's first line, as GitHub requires — a
// blockquote merely *starting* with "[!NOTE] something" is not an alert.
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i;

// Deliberately loose: this file only ever reads `type`/`children`/`value` and writes
// `data`, so mirroring the full mdast type surface (a transitive dependency, not a
// declared one) would buy nothing.
interface Node {
  type: string;
  value?: string;
  data?: Record<string, unknown>;
  children?: Node[];
}

function toCallout(node: Node): void {
  const [firstBlock] = node.children ?? [];
  if (firstBlock?.type !== "paragraph") return;
  const [lead] = firstBlock.children ?? [];
  if (lead?.type !== "text" || typeof lead.value !== "string") return;

  const match = ALERT_MARKER.exec(lead.value);
  if (!match) return;
  const kind = match[1].toLowerCase();
  if (!isCalloutKind(kind)) return;

  // Drop the marker line, then drop whatever it leaves empty behind it: an alert whose
  // body starts on the next line leaves an empty text node, and `> [!NOTE]` with no body
  // at all leaves an empty paragraph.
  lead.value = lead.value.slice(match[0].length);
  if (lead.value === "") firstBlock.children?.shift();
  if (firstBlock.children?.length === 0) node.children?.shift();

  const icon = calloutIconHast(kind);
  const body = node.children ?? [];

  node.data = { hName: "div", hProperties: { className: ["callout"], "data-callout": kind } };
  node.children = [
    { type: "paragraph", data: { hName: "svg", hProperties: icon.properties, hChildren: icon.children }, children: [] },
    {
      type: "blockquote",
      data: { hName: "div", hProperties: { className: ["callout-body"] } },
      children: [
        {
          type: "paragraph",
          data: { hProperties: { className: ["callout-label"] } },
          children: [{ type: "text", value: calloutKinds[kind].label }],
        },
        ...body,
      ],
    },
  ];
}

function walk(node: Node): void {
  for (const child of node.children ?? []) {
    walk(child);
    if (child.type === "blockquote") toCallout(child);
  }
}

export default function remarkGithubAlerts() {
  return (tree: Node): void => walk(tree);
}
