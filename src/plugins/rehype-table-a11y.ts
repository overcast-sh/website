/**
 * Two fixes to every markdown table the site renders, applied to the hast tree after
 * markdown has become HTML:
 *
 * 1. The table is wrapped in a focusable `.table-scroll` div. The service reference
 *    tables are wider than the column they sit in, so something has to scroll. Doing
 *    that with `display: block` on the <table> itself — which is what the stylesheet
 *    used to do — costs the table its role: with a block display the rows and cells
 *    stop being exposed as rows and cells, so a screen reader reads a wall of text
 *    instead of "Request, column 1". Scrolling the wrapper keeps `display: table`.
 *    The wrapper also takes `tabindex="0"`, because a scroll container that is not
 *    focusable can only be scrolled by pointer (WCAG 2.1.1 Keyboard).
 *
 * 2. Header cells get `scope="col"` (or `scope="row"` for a leading header column),
 *    so the association is stated rather than inferred. An empty header cell — the
 *    blank corner above a row-label column, which markdown writes as `| |` — becomes a
 *    <td>: a header that names nothing is not a header, and announcing "blank, column
 *    one" before every row is worse than announcing nothing.
 *
 * Written here rather than pulled in as a package for the same reason as
 * remark-github-alerts.ts: the transform is shorter than the config it would take.
 */

interface Element {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Element[];
}

function isTag(node: Element | undefined, tag: string): boolean {
  return node?.type === "element" && node.tagName === tag;
}

function hasText(node: Element): boolean {
  if (node.type === "text") return String((node as { value?: string }).value ?? "").trim() !== "";
  return (node.children ?? []).some(hasText);
}

/** `scope="col"` inside <thead>, `scope="row"` for a <th> that leads a body row. */
function annotateHeaderCells(table: Element): void {
  for (const section of table.children ?? []) {
    if (section.type !== "element") continue;
    const inHead = section.tagName === "thead";
    for (const row of section.children ?? []) {
      if (!isTag(row, "tr")) continue;
      const cells = (row.children ?? []).filter((cell) => cell.type === "element");
      cells.forEach((cell, index) => {
        if (cell.tagName !== "th") return;
        if (!hasText(cell)) {
          cell.tagName = "td";
          return;
        }
        cell.properties ??= {};
        if (cell.properties.scope) return;
        cell.properties.scope = inHead || index > 0 ? "col" : "row";
      });
    }
  }
}

function walk(node: Element): void {
  const children = node.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    walk(child);
    if (!isTag(child, "table")) continue;
    annotateHeaderCells(child);
    children[index] = {
      type: "element",
      tagName: "div",
      properties: { className: ["table-scroll"], tabIndex: 0 },
      children: [child],
    };
  }
}

export default function rehypeTableA11y() {
  return (tree: Element): void => walk(tree);
}
