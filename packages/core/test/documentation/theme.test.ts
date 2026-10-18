import { describe, expect, it } from "bun:test";
import { buildSite } from "@snagentic/core";
import { ALL, fakeSources, NO_MEDIA, run } from "../support/docs-fixtures";

const text = (value: string) => new TextEncoder().encode(value);

async function build(theme?: { path: string; content: Uint8Array }[]) {
  const { sources } = fakeSources(ALL, theme === undefined ? {} : { theme });
  let written: readonly { path: string; content: string | Uint8Array }[] = [];
  await buildSite({
    ...run,
    sources,
    markdown: { html: (md) => md },
    output: {
      root: "/ws/site",
      replace: async (files) => {
        written = files;
      },
    },
    media: NO_MEDIA,
  });
  const file = (path: string) => written.find((item) => item.path === path)?.content;
  return { file, written };
}

describe("docs build: a client's theme", () => {
  it("links the theme after the site's styles on every page, so it can override them", async () => {
    const { file } = await build();
    const page = String(file("processes/incident/operate/assign.html"));
    expect(page).toContain(
      '<link rel="stylesheet" href="../../../assets/site.css"><link rel="stylesheet" href="../../../assets/theme/theme.css">',
    );
    expect(page).toContain('<span class="logo" aria-hidden="true"></span>');
  });

  it("ships a commented template naming every token when the workspace has no theme", async () => {
    const { file } = await build();
    const template = String(file("assets/theme/theme.css"));
    for (const token of [
      "--brand",
      "--font",
      "--radius",
      "--header-bg",
      "--side-bg",
      "--width",
      ".logo",
    ]) {
      expect(template).toContain(token);
    }
    expect(String(file("assets/site.css"))).toContain("--brand:");
  });

  it("publishes the workspace's theme folder as it is, with its images", async () => {
    const logo = new Uint8Array([60, 115, 118, 103]);
    const { file, written } = await build([
      { path: "theme.css", content: text(":root{--brand:#7B2D8E}") },
      { path: "logo.svg", content: logo },
    ]);
    expect(file("assets/theme/theme.css")).toEqual(text(":root{--brand:#7B2D8E}"));
    expect(file("assets/theme/logo.svg")).toEqual(logo);
    expect(written.filter((item) => item.path === "assets/theme/theme.css")).toHaveLength(1);
  });
});
