// Captures the Overcast web console screenshots rendered by the /console page.
//
// Point it at a running emulator that already has the sample stacks deployed and seeded:
//   OVERCAST_S3_BUCKET=<bucket> node scripts/capture-console.mjs
//
// Options (env or CLI):
//   OVERCAST_CONSOLE_URL   / --url=      console origin (default http://localhost:4567)
//   OVERCAST_S3_BUCKET     / --bucket=   bucket for the object-browser screenshot
//   OVERCAST_CAPTURE_DEBUG_DIR           traces + failure shots (default .tmp/capture-debug)
//                          / --only=     comma-separated scenario names, for local debugging
//
// Selectors below are taken from the console source (overcast-sh/overcast, web/src). The app
// authors no data-testids of its own, so the anchors are ARIA roles, aria-labels, exact visible
// text, and — on the map — the testids React Flow itself emits.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const cwd = process.cwd();
const outputDir = path.join(cwd, "public", "console");

function flag(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

const consoleUrl = (flag("url") || process.env.OVERCAST_CONSOLE_URL || "http://localhost:4567").replace(/\/+$/, "");
const bucket = flag("bucket") || process.env.OVERCAST_S3_BUCKET || "";
const debugDir = path.resolve(cwd, process.env.OVERCAST_CAPTURE_DEBUG_DIR || ".tmp/capture-debug");
const only = (flag("only") || "").split(",").map((value) => value.trim()).filter(Boolean);

const viewport = { width: 1600, height: 1000 };
const navigationTimeout = 90_000; // the console is lazy-loaded, so the first route is the slow one
const actionTimeout = 30_000;
const attemptsPerScenario = 2;

// One clock base for the whole run, so all four screenshots agree on "now". Time keeps ticking
// while the page loads (clock.install resumes real time), then pauses at a fixed offset just
// before the shot: that stops counters, ageing pills and re-render churn between the readiness
// assertion and the capture, without freezing the app while it is still fetching.
const clockStart = new Date();
const clockPauseAt = new Date(clockStart.getTime() + 60_000);

// The only sleep in this script. clock.pauseAt() fires due timers once as it stops the clock, so
// a re-render can be in flight at that moment and nothing observable says "the repaint caused by
// pausing has landed". Bounded and deliberately short.
const pausedRenderSettleMs = 200;

const freezeAnimationsCss = `
*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
`;

/**
 * @typedef {import("playwright").Page} Page
 *
 * @typedef {object} Scenario
 * @property {string} name        output file name, without extension
 * @property {string} route       path appended to the console origin
 * @property {(page: Page) => Promise<void>} [steps]    interactions to perform before capture
 * @property {(page: Page) => Promise<void>} readyWhen  fails the attempt if the page never gets there
 * @property {(page: Page, file: string) => Promise<void>} [capture]  defaults to a viewport shot
 */

/** @type {Scenario[]} */
const scenarios = [
  {
    name: "console-dashboard",
    route: "/",
    async readyWhen(page) {
      // Sections are <section aria-label="fully emulated"> — authored lowercase, uppercased by
      // CSS, so the accessible name is lowercase too. Each service tile inside is a link.
      const fullyEmulated = page.getByRole("region", { name: "fully emulated" });
      await fullyEmulated.getByRole("link").first().waitFor({ state: "visible" });
      // The service grid renders from a static list even when the emulator is unreachable; the
      // footer is the only thing gated on the health payload, so it is the real "data arrived".
      await page.getByText(/^Emulator .+ services/).waitFor({ state: "visible" });
    },
  },
  {
    // The object listing, not the inspector: the inspector is a modal dialog that covers the
    // very browser this screenshot is meant to show.
    name: "console-resources",
    route: `/s3/${encodeURIComponent(bucket)}/objects/`,
    async readyWhen(page) {
      // An unknown bucket bounces to /s3 with a toast, so pin the <h1> to the bucket name rather
      // than screenshotting whatever we landed on.
      await page.getByRole("heading", { level: 1, name: bucket, exact: true }).waitFor({ state: "visible" });
      // The listing is virtualized: real rows carry data-index, the spacer rows do not.
      await page.locator("tbody tr[data-index]").first().waitFor({ state: "visible" });
    },
  },
  {
    name: "console-map",
    route: "/map",
    async readyWhen(page) {
      // React Flow's wrapper only mounts once laid-out nodes exist — before that the map area is
      // blank with no spinner, no empty state and no error, so this is the load-bearing check.
      await page.getByTestId("rf__wrapper").waitFor({ state: "visible" });
      await page.locator(".react-flow__node").first().waitFor({ state: "visible" });
      await waitForMapCameraToSettle(page);
    },
  },
  {
    name: "console-events",
    route: "/events",
    async steps(page) {
      // Fill the stream before pausing it — pausing early would freeze "Waiting for events…".
      // Rows are virtualized divs keyed by data-index, the only handle this console offers.
      await page.locator("[data-index]").first().waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Pause", exact: true }).click();
    },
    async readyWhen(page) {
      // The button label is the state: Pause -> Resume once the stream is frozen.
      await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ state: "visible" });
      await page.locator("[data-index]").first().waitFor({ state: "visible" });
    },
  },
];

// The map fires several fitView/setCenter camera animations after the nodes appear, and nothing
// in the DOM announces that layout has finished. Watch the transform React Flow writes onto the
// viewport instead, and call it settled once it stops changing.
async function waitForMapCameraToSettle(page) {
  await page.waitForFunction(
    () => {
      const viewport = document.querySelector(".react-flow__viewport");
      if (!viewport) return false;

      const state = (window.__overcastCameraWatch ||= { transform: null, stableSamples: 0 });
      const transform = getComputedStyle(viewport).transform;
      if (transform !== state.transform) {
        state.transform = transform;
        state.stableSamples = 0;
        return false;
      }

      state.stableSamples += 1;
      return state.stableSamples >= 3;
    },
    null,
    { polling: 100, timeout: 20_000 },
  );
}

async function waitForShell(page) {
  // Nothing renders until ConnectionGate has seen the emulator answer once; the header is the
  // first thing that exists on the other side of it.
  await page.getByRole("banner").waitFor({ state: "visible" });
  // The reconnect toast carries a per-second countdown, so never shoot with it on screen.
  await page.getByRole("region", { name: "Connection status" }).waitFor({ state: "hidden" });
}

async function settle(page) {
  await page.evaluate(async () => {
    // SMIL is immune to the injected CSS freeze; the map animates particles along its edges
    // with <animateMotion>, and pausing each SVG timeline stops them where they are.
    for (const svg of document.querySelectorAll("svg")) svg.pauseAnimations();
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function captureViewport(page, file) {
  await page.screenshot({ path: file, animations: "disabled", caret: "hide", scale: "css" });
}

async function runScenario(browser, scenario, attempt) {
  // A fresh context per attempt: empty localStorage means the dashboard is in its default grid
  // view with no "recently visited" reordering, so the grid looks the same every run.
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  context.setDefaultTimeout(actionTimeout);
  context.setDefaultNavigationTimeout(navigationTimeout);
  await context.tracing.start({ name: scenario.name, screenshots: true, snapshots: true });

  const page = await context.newPage();
  const pageLog = [];
  page.on("pageerror", (error) => pageLog.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") pageLog.push(`console.error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => pageLog.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));

  try {
    await page.clock.install({ time: clockStart });
    await page.goto(`${consoleUrl}${scenario.route}`, { waitUntil: "domcontentloaded" });

    // Injected before any interaction so nothing is captured, clicked or measured mid-animation.
    await page.addStyleTag({ content: freezeAnimationsCss });
    await waitForShell(page);

    if (scenario.steps) await scenario.steps(page);
    await scenario.readyWhen(page);

    await settle(page);
    await page.clock.pauseAt(clockPauseAt);
    await page.waitForTimeout(pausedRenderSettleMs);

    const capture = scenario.capture || captureViewport;
    await capture(page, path.join(outputDir, `${scenario.name}.png`));

    await context.tracing.stop();
  } catch (error) {
    const prefix = path.join(debugDir, `${scenario.name}-attempt-${attempt}`);
    await fs.mkdir(debugDir, { recursive: true });
    await context.tracing.stop({ path: `${prefix}.trace.zip` }).catch(() => {});
    await page.screenshot({ path: `${prefix}.png`, fullPage: true }).catch(() => {});
    if (pageLog.length > 0) await fs.writeFile(`${prefix}.log`, `${pageLog.join("\n")}\n`, "utf8");
    throw error;
  } finally {
    await context.close();
  }
}

function selectScenarios() {
  if (only.length === 0) return scenarios;

  const unknown = only.filter((name) => !scenarios.some((scenario) => scenario.name === name));
  if (unknown.length > 0) {
    throw new Error(`Unknown scenario(s): ${unknown.join(", ")}. Known: ${scenarios.map((s) => s.name).join(", ")}`);
  }
  return scenarios.filter((scenario) => only.includes(scenario.name));
}

async function main() {
  const selected = selectScenarios();

  if (!bucket && selected.some((scenario) => scenario.name === "console-resources")) {
    throw new Error("Set OVERCAST_S3_BUCKET (or pass --bucket=) to capture the S3 object browser.");
  }

  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch();
  const failed = [];

  try {
    for (const scenario of selected) {
      for (let attempt = 1; attempt <= attemptsPerScenario; attempt++) {
        try {
          await runScenario(browser, scenario, attempt);
          console.log(`Captured ${scenario.name} from ${consoleUrl}${scenario.route}`);
          break;
        } catch (error) {
          console.error(`Attempt ${attempt}/${attemptsPerScenario} for ${scenario.name} failed: ${error.message}`);
          if (attempt === attemptsPerScenario) failed.push(scenario.name);
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (failed.length > 0) {
    console.error(`::error::Console capture failed for: ${failed.join(", ")}. Traces are in ${debugDir}.`);
    process.exitCode = 1;
  }
}

await main();
