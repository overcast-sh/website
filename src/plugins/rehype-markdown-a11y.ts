/**
 * Accessibility repairs to every markdown the site renders — synced docs and release
 * bodies alike — applied to the hast tree after markdown has become HTML.
 *
 * Heading levels never skip. `docs/services/ec2.md` opens `# EC2` and then jumps
 * straight to `###`, so its outline claims a level-two section that was never written
 * and anyone navigating by heading level walks past two of them. A skipped level in
 * markdown is a defect rather than a choice — heading level carries no styling intent
 * there — so each heading is clamped to at most one deeper than the heading before it.
 * The clamp only ever raises a heading, and never to `<h1>`: the page chrome supplies
 * the one `<h1>`, and a release body that opens at `##` has to stay at `##`.
 *
 * And two fixes to every table:
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

const HEADING = /^h([1-6])$/;

/**
 * Closes off every open section the new heading is a sibling of or an ancestor to, then
 * puts it one level under whatever is still open. Two `###`s that share a missing `##`
 * parent stay siblings — a plain "no more than one deeper than the last" clamp would
 * nest the second one inside the first.
 */
function normalizeHeading(child: Element, level: number, stack: Array<{ source: number; output: number }>): void {
  if (level === 1) {
    child.tagName = "h1";
    stack.length = 0;
    stack.push({ source: 1, output: 1 });
    return;
  }
  while (stack.length > 0 && stack[stack.length - 1].source >= level) stack.pop();
  const parent = stack.length > 0 ? stack[stack.length - 1].output : 1;
  const output = Math.min(6, Math.max(2, parent + 1));
  child.tagName = `h${output}`;
  stack.push({ source: level, output });
}

/** The open-section stack spans the whole document, not one subtree. */
function walk(node: Element, stack: Array<{ source: number; output: number }>): void {
  const children = node.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];

    const heading = child.type === "element" ? HEADING.exec(child.tagName ?? "") : null;
    if (heading) normalizeHeading(child, Number(heading[1]), stack);

    walk(child, stack);
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

export default function rehypeMarkdownA11y() {
  // The stack starts empty, which puts a document's first heading at <h2>: the page
  // chrome renders the title as the one <h1>, so the body always begins one level down.
  return (tree: Element): void => walk(tree, []);
}
