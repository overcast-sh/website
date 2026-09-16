// Unit tests for the markdown twins of the site's own pages. Run with `npm test` (Node's
// built-in test runner, with its native TypeScript stripping — site-markdown.ts imports one
// type and one label helper, so nothing here needs a bundler or a content collection).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceSupportManifest } from "./generated-content.ts";
import {
  consoleMarkdown,
  contributingMarkdown,
  docsIndexMarkdown,
  downloadsMarkdown,
  homeMarkdown,
  releasesMarkdown,
  supportMarkdown,
  type ReleaseLike,
} from "./site-markdown.ts";

const ORIGIN = "https://overcast.sh";
const options = { origin: ORIGIN };

const MANIFEST: ServiceSupportManifest = {
  generatedBy: "test",
  totalOps: 30,
  implementedOps: 25,
  services: [
    {
      service: "s3",
      docSlug: "s3",
      displayName: "S3",
      totalOps: 20,
      implementedOps: 19,
      coverage: 95,
      coverageTier: "Comprehensive / broad support",
      operations: [],
    },
    {
      service: "elbv2",
      docSlug: "elb",
      displayName: "ELB",
      totalOps: 10,
      implementedOps: 6,
      coverage: 60,
      coverageTier: "Core CRUD + common workflows",
      operations: [],
    },
  ],
} as ServiceSupportManifest;

/** Every twin opens with an H1 then a blockquote, like the llms.txt indexes do. */
function assertPageShape(markdown: string) {
  const [heading, blank, summary] = markdown.split("\n");
  assert.match(heading, /^# \S/);
  assert.equal(blank, "");
  assert.match(summary, /^> /);
  assert.match(markdown, /[^\n]\n$/);
}

describe("supportMarkdown", () => {
  const output = supportMarkdown(MANIFEST, options);

  it("reads as a page", () => assertPageShape(output));

  it("states the totals and the gap, so the numbers don't have to be added up", () => {
    assert.match(output, /Of 30 listed operations across 2 services, 25 are implemented and 5 return HTTP 501\./);
  });

  it("orders services by display name, not by the id they happen to carry", () => {
    const names = [...output.matchAll(/^\| \[([^\]]+)\]/gm)].map((match) => match[1]);
    assert.deepEqual(names, ["ELB", "S3"]);
  });

  // `elbv2` is the support data's id and `elb` is the doc's — a row that linked the former
  // would 404, which is exactly why docSlug exists.
  it("links a service by its doc slug rather than its service id", () => {
    assert.match(output, /\| \[ELB\]\(https:\/\/overcast\.sh\/docs\/services\/elb\/index\.md\) \| 6\/10 \| 60% \|/);
  });

  it("says so plainly when a build has no service data", () => {
    const empty = supportMarkdown({ ...MANIFEST, totalOps: 0, implementedOps: 0, services: [] }, options);
    assert.match(empty, /_No service data in this build\._/);
  });
});

describe("releasesMarkdown", () => {
  const releases: ReleaseLike[] = [
    { tagName: "v2", name: "v2", publishedAt: "2026-09-01T10:00:00Z", url: "https://example.com/v2", prerelease: false },
    { tagName: "v1", name: "v1", publishedAt: null, prerelease: true },
  ];
  const output = releasesMarkdown(releases, options);

  it("reads as a page", () => assertPageShape(output));

  it("dates a release to the day, dropping the time nobody needs", () => {
    assert.match(output, /\| \[v2\]\(https:\/\/example\.com\/v2\) \| 2026-09-01 \| release \|/);
  });

  it("marks a pre-release, and an unpublished one as unreleased", () => {
    assert.match(output, /\| v1 \| unreleased \| pre-release \|/);
  });

  it("says so plainly when nothing has been published", () => {
    assert.match(releasesMarkdown([], options), /_No releases published yet\._/);
  });
});

describe("downloadsMarkdown", () => {
  const latest: ReleaseLike = {
    tagName: "v2",
    name: "v2",
    publishedAt: "2026-09-01T10:00:00Z",
    assets: [{ name: "overcast_linux_amd64.tar.gz", downloadUrl: "https://example.com/a.tar.gz", size: 24_500_000 }],
  };
  const output = downloadsMarkdown({ ...options, latest, commands: [{ label: "Run it:", command: "docker run x" }] });

  it("reads as a page", () => assertPageShape(output));

  it("fences the command it was given rather than describing it", () => {
    assert.match(output, /Run it:\n\n```bash\ndocker run x\n```/);
  });

  it("sizes an asset in megabytes", () => {
    assert.match(output, /\| \[overcast_linux_amd64\.tar\.gz\]\(https:\/\/example\.com\/a\.tar\.gz\) \| 24\.5 MB \|/);
  });

  it("copes with no release at all", () => {
    const none = downloadsMarkdown({ ...options, commands: [] });
    assert.match(none, /No release has been published yet\./);
    assert.match(none, /_The current release publishes no binary assets\._/);
  });
});

describe("homeMarkdown", () => {
  const output = homeMarkdown({ ...options, commands: [], serviceCount: 50, latestVersion: "v0.0.1-alpha.42" });

  it("reads as a page", () => assertPageShape(output));

  it("carries the service count and version from the build, not from prose", () => {
    assert.match(output, /emulates 50 services/);
    assert.match(output, /The current release is v0\.0\.1-alpha\.42\./);
  });

  it("leaves the version sentence out when there is no release", () => {
    const output = homeMarkdown({ ...options, commands: [], serviceCount: 50 });
    assert.doesNotMatch(output, /The current release is/);
  });

  it("points an agent at the index rather than only at pages", () => {
    assert.match(output, /\[llms\.txt\]\(https:\/\/overcast\.sh\/llms\.txt\)/);
  });
});

describe("docsIndexMarkdown", () => {
  const output = docsIndexMarkdown({
    ...options,
    sections: [
      {
        section: "Getting Started",
        entries: [{ title: "Install", slug: "docs/install", description: "One line installs it." }],
      },
    ],
  });

  it("reads as a page", () => assertPageShape(output));

  it("groups entries under their section and links the markdown twin", () => {
    assert.match(output, /^## Getting Started$/m);
    assert.match(output, /- \[Install\]\(https:\/\/overcast\.sh\/docs\/install\/index\.md\): One line installs it\./);
  });
});

describe("the prose twins", () => {
  it("console reads as a page and names the port it answers on", () => {
    const output = consoleMarkdown(options);
    assertPageShape(output);
    assert.match(output, /4567/);
  });

  // The point of this page is which repository a change belongs in, so both have to be in it.
  it("contributing reads as a page and names both repositories", () => {
    const output = contributingMarkdown({
      ...options,
      repositoryUrl: "https://github.com/overcast-sh/overcast",
      websiteRepositoryUrl: "https://github.com/overcast-sh/website",
    });
    assertPageShape(output);
    assert.match(output, /overcast-sh\/overcast/);
    assert.match(output, /overcast-sh\/website/);
  });
});
