import { describe, expect, it } from "bun:test";
import { buildSite } from "@snagentic/core";
import { ALL, fakeSources, NO_MEDIA, PROCESS, run, SITE } from "../support/docs-fixtures";

const GUIDE = {
  title: "Employee guide",
  intro: "How to get help from IT.",
  start: ["incident/report"],
  tasks: [
    {
      title: "Something is broken",
      summary: "Report it and follow it.",
      icon: "alert",
      pages: ["incident/report", "incident/confirm"],
    },
  ],
};

async function build(employees: unknown = GUIDE, process: unknown = { ...PROCESS, icon: "flame" }) {
  const site = employees === null ? SITE : { ...SITE, employees };
  const { sources } = fakeSources(ALL, { site, process });
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
  });
  const file = (path: string) => String(written.find((item) => item.path === path)?.content ?? "");
  return { file, written };
}

const sidebar = (page: string) =>
  page.slice(
    page.indexOf('<nav class="side"'),
    page.indexOf("</nav>", page.indexOf('<nav class="side"')),
  );

describe("docs build: the menu", () => {
  it("gives every page a rail to the site map and both guides, and a button that hides the menu", async () => {
    const { file } = await build();
    const page = file("processes/incident/use/confirm.html");
    expect(page).toContain(
      '<button class="navtoggle" type="button" aria-label="Menu" aria-controls="menu"',
    );
    expect(page).toContain('<nav class="rail"');
    expect(page).toContain('href="../../../index.html"');
    expect(page).toContain('href="../../../employees/index.html"');
    expect(page).toContain('href="../../../it/index.html"');
    expect(page).toContain("localStorage.getItem('snagentic-nav')");
  });

  it("shows on an employee page the employee guide's groups, with the current page marked", async () => {
    const { file } = await build();
    const side = sidebar(file("processes/incident/use/confirm.html"));
    expect(side).toContain("Employee guide");
    expect(side).toContain("Start here");
    expect(side).toContain("Something is broken");
    expect(side).toContain(
      '<a aria-current="page" href="../../../processes/incident/use/confirm.html">',
    );
    expect(side).toContain("How incident management works");
    expect(side).not.toContain("Assign an incident");
    expect(side).not.toContain("configure/");
  });

  it("shows on an operator's page the IT guide: each process with its pages, its own open", async () => {
    const { file } = await build();
    const side = sidebar(file("processes/incident/operate/assign.html"));
    expect(side).toContain("IT guide");
    expect(side).toContain('<details class="proc" open>');
    expect(side).toContain("Incident management");
    expect(side).toContain(
      'href="../../../processes/incident/operate/resolve.html">Resolve an incident</a>',
    );
    expect(side).toContain('href="../../../processes/incident/configure/index.html">');
    expect(side).not.toContain("Confirm or reopen the fix");
  });

  it("searches the guide offline, from an index of titles, headings and summaries", async () => {
    const { file } = await build();
    const index = file("assets/search.js");
    expect(index.startsWith("window.SNAGENTIC_SEARCH=")).toBe(true);
    expect(index).toContain('"u":"processes/incident/use/confirm.html","g":"employee"');
    expect(index).toContain('"u":"processes/incident/operate/assign.html","g":"it"');
    expect(index).toContain("who gets the incident");
    expect(index).toContain('"t":"Assign an incident","p":"Incident management"');
    const user = index.slice(
      index.indexOf('"processes/incident/use/understand/overview.html"') - 80,
    );
    expect(user.slice(0, 200)).not.toContain("assignment_group");
    expect(sidebar(file("processes/incident/use/confirm.html"))).toContain(
      '<input class="search" type="search" placeholder="Search" data-guide="employee"',
    );
  });
});

describe("docs build: the site map", () => {
  it("opens the site on a map: a card per employee task and per process, with icons and links", async () => {
    const { file } = await build();
    const map = file("index.html");
    expect(map).toContain('<section class="map">');
    expect(map).toContain('<div class="card"><h3><svg');
    expect(map).toContain("Something is broken");
    expect(map).toContain(
      'href="processes/incident/use/confirm.html">Confirm or reopen the fix</a>',
    );
    expect(map).toContain('href="processes/incident/operate/assign.html">Assign an incident</a>');
    expect(map).toContain('data-icon="flame"');
    expect(map).toContain('data-icon="alert"');
  });

  it("maps a site without an employee guide by process, and falls back to a plain icon", async () => {
    const { file } = await build(null, { ...PROCESS, icon: "no-such-icon" });
    const map = file("index.html");
    expect(map).toContain('<section class="map">');
    expect(map).toContain('data-icon="doc"');
    expect(map).not.toContain("employees/index.html");
    expect(file("processes/incident/use/confirm.html")).not.toContain("employees/index.html");
  });
});

describe("docs build: what the IT guide leaves out", () => {
  it("leaves a process with nothing for IT out of the IT menu and the IT cards", async () => {
    const help = {
      path: "processes/getting-help/process.yaml",
      process: {
        title: "Getting help",
        roles: [{ id: "employee", name: "Employee", audience: "user" }],
        capabilities: [{ id: "channels", title: "Ways to get help", roles: ["employee"] }],
      },
    };
    const { sources } = fakeSources(ALL, { site: { ...SITE, employees: GUIDE }, others: [help] });
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
    const file = (path: string) => String(written.find((item) => item.path === path)?.content);
    expect(sidebar(file("processes/incident/operate/assign.html"))).not.toContain("Getting help");
    expect(file("it/index.html")).not.toContain("Getting help");
    expect(file("it/index.html")).toContain("Incident management");
  });
});

describe("docs build: the menu for keyboards and screen readers", () => {
  it("offers a skip link, names the site in the title, marks the guide's home and announces results", async () => {
    const { file } = await build();
    const page = file("employees/index.html");
    expect(page).toContain('<a class="skip" href="#main">Skip to the content</a>');
    expect(page).toContain('<main id="main">');
    expect(page).toContain("<title>Employee guide · Incident docs</title>");
    expect(page).toContain('aria-current="page" href="../employees/index.html">');
    expect(page).toContain('<p class="count" role="status" aria-live="polite"></p>');
    expect(page).toContain(
      "matchMedia('(max-width: 800px)').matches||localStorage.getItem('snagentic-nav')==='hidden'",
    );
    expect(file("processes/incident/operate/assign.html")).toContain(
      '<nav class="crumbs" aria-label="Breadcrumb">',
    );
  });
});

describe("docs build: which processes employees read about", () => {
  it("lists under How it works only the processes site.yaml names, in its order", async () => {
    const { file } = await build({ ...GUIDE, how: ["incident"] }, undefined);
    const side = sidebar(file("employees/index.html"));
    expect(side).toContain("How incident management works");
    const none = await build({ ...GUIDE, how: [] }, undefined);
    expect(sidebar(none.file("employees/index.html"))).not.toContain(
      "How incident management works",
    );
    expect(none.file("index.html")).not.toContain("Each process in plain words.");
  });
});
