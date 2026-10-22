import { describe, expect, it } from "bun:test";
import { buildSite, recordUrl } from "@snagentic/core";
import { ALL, fakeSources, NO_MEDIA, PROCESS, run } from "../support/docs-fixtures";

async function build(instanceUrl?: (instance: string) => Promise<string | null>) {
  const { sources } = fakeSources(ALL, { process: { ...PROCESS, tables: ["incident"] } });
  let written: readonly { path: string; content: string | Uint8Array }[] = [];
  await buildSite({
    ...run,
    sources,
    markdown: { html: (md) => `<md>${md}</md>` },
    output: {
      root: "/ws/.snagentic/site",
      replace: async (files) => {
        written = files;
      },
    },
    media: NO_MEDIA,
    ...(instanceUrl === undefined ? {} : { instanceUrl }),
  });
  return (path: string) => String(written.find((item) => item.path === path)?.content ?? "");
}

const PDI2 = async (instance: string) =>
  instance === "pdi2" ? "https://dev389847.service-now.com/" : null;

describe("docs build: links to the instance", () => {
  it("opens a record's form on the instance", () => {
    expect(recordUrl("https://dev1.service-now.com/", "sys_script", "abc")).toBe(
      "https://dev1.service-now.com/sys_script.do?sys_id=abc",
    );
  });

  it("links each record of a page's evidence to its form on the instance", async () => {
    const file = await build(PDI2);
    expect(file("processes/incident/operate/assign.html")).toContain(
      '<a href="https://dev389847.service-now.com/sys_ux_list.do?sys_id=8a2e7e1fc3a31110ec3f1d0d05013152" target="_blank" rel="noopener"><code>sys_ux_list/8a2e7e1fc3a31110ec3f1d0d05013152</code></a>',
    );
  });

  it("links the configuration index's records, documented or not", async () => {
    const records = (await build(PDI2))("processes/incident/configure/records.html");
    expect(records).toContain(
      'href="https://dev389847.service-now.com/sys_script.do?sys_id=aa000000000000000000000000000001"',
    );
  });

  it("leaves screen evidence, which has no record, unlinked", async () => {
    const page = (await build(PDI2))("processes/incident/use/confirm.html");
    expect(page).not.toContain("service-now.com");
  });

  it("names records without links when the workspace doesn't know the instance's address", async () => {
    const page = (await build(async () => null))("processes/incident/operate/assign.html");
    expect(page).toContain("<td><code>sys_ux_list/8a2e7e1fc3a31110ec3f1d0d05013152</code></td>");
    expect(page).not.toContain("target=");
  });
});
