import { describe, expect, it } from "bun:test";
import { buildSite } from "@snagentic/core";
import { ALL, fakeSources, NO_MEDIA, PROCESS, run, SITE } from "../support/docs-fixtures";

const GUIDE = {
  title: "Employee guide",
  intro: "How to get help from IT.",
  start: ["incident/report"],
  tasks: [{ title: "Something is broken", summary: "Report it.", pages: ["incident/confirm"] }],
};

const FEATURES = {
  features: [
    {
      id: "core",
      title: "Incident handling",
      found: ["global"],
      status: "documented",
      capabilities: ["assign", "report"],
    },
    { id: "discuss", title: "Discuss", found: ["sn_sow_collab"], status: "todo" },
    {
      id: "cab",
      title: "CAB <meetings>",
      found: ["sn_change_cab"],
      status: "out-of-scope",
      note: "Belongs to change.",
    },
  ],
};

async function build(features: unknown) {
  const { sources } = fakeSources(ALL, {
    site: { ...SITE, employees: GUIDE },
    process: { ...PROCESS, tables: ["incident"] },
  });
  const withFeatures =
    features === null
      ? sources
      : {
          ...sources,
          features: async () => [{ path: "processes/incident/features.yaml", features }],
        };
  let written: readonly { path: string; content: string | Uint8Array }[] = [];
  await buildSite({
    ...run,
    sources: withFeatures,
    markdown: { html: (md) => md },
    output: {
      root: "/ws/site",
      replace: async (files) => {
        written = files;
      },
    },
    media: NO_MEDIA,
  });
  return (path: string) => String(written.find((item) => item.path === path)?.content ?? "");
}

describe("docs build: a process's features (ADR-0040)", () => {
  it("lists each feature on the process's IT page with its decision and its pages", async () => {
    const file = await build(FEATURES);
    const page = file("processes/incident/index.html");
    expect(page).toContain("<h2>Features</h2>");
    expect(page).toContain("1 of 2 features documented");
    expect(page).toContain('<span class="label label-new">Documented</span>');
    expect(page).toContain(
      'href="../../processes/incident/operate/assign.html">Assign an incident</a>',
    );
    expect(page).toContain(
      'href="../../processes/incident/use/report.html">Report an incident</a>',
    );
    expect(page).toContain('<span class="label label-corrected">To do</span>');
    expect(page).toContain("CAB &lt;meetings&gt;");
    expect(page).toContain("Belongs to change.");
    expect(file("it/index.html")).toContain("(1 of 2 features documented.)");
  });

  it("shows no features section for a process without features.yaml", async () => {
    const file = await build(null);
    expect(file("processes/incident/index.html")).not.toContain("<h2>Features</h2>");
    expect(file("it/index.html")).not.toContain("features documented");
  });
});
