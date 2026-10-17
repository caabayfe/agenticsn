import type { DocPage } from "./page";
import { playerHtml } from "./player";
import type { Process } from "./process";
import { built, type SiteInput } from "./site-context";
import { employeesHomeHtml, frontDoorHtml } from "./site-employees";
import { configureHomeHtml, indexHtml, processHtml, viewHomeHtml } from "./site-homes";
import { recordsFile, recordsHtml } from "./site-index";
import { EMPLOYEES_HOME, IT_HOME, pageFile, sectionHome } from "./site-layout";
import { configureHtml, guideHtml, understandHtml } from "./site-pages";
import { SITE_STYLE } from "./site-style";
import { SECTION_VIEW } from "./structure";
import { VIEWS } from "./views";

export type { SiteInput } from "./site-context";

export interface SiteFile {
  // Relative to the site's root folder.
  readonly path: string;
  readonly content: string | Uint8Array;
}

type Build = ReturnType<typeof built>;

function pageFiles(b: Build, process: Process, page: DocPage): readonly SiteFile[] {
  if (page.section === "understand") {
    return VIEWS.map((view) => ({
      path: pageFile(page, view),
      content: understandHtml(b, process, page, view),
    }));
  }
  if (page.section === "configure") {
    return [{ path: pageFile(page), content: configureHtml(b, process, page) }];
  }
  const view = SECTION_VIEW[page.section];
  return view === undefined
    ? []
    : [{ path: pageFile(page), content: guideHtml(b, process, page, view) }];
}

function processFiles(b: Build, process: Process): readonly SiteFile[] {
  const index = b.input.indexes?.get(process.id);
  return [
    ...(index === undefined
      ? []
      : [{ path: recordsFile(process.id), content: recordsHtml(b, process, index) }]),
    { path: `processes/${process.id}/index.html`, content: processHtml(b, process) },
    ...VIEWS.map((view) => ({
      path: sectionHome(process.id, view === "user" ? "use" : "operate"),
      content: viewHomeHtml(b, process, view),
    })),
    { path: sectionHome(process.id, "configure"), content: configureHomeHtml(b, process) },
    ...b.input.pages
      .filter((page) => page.process === process.id)
      .flatMap((page) => pageFiles(b, process, page)),
  ];
}

// Every file of the static site: the index (or, with an employee guide, the front door and the
// two guides' homes, ADR-0037); per process its page, the three section homes, the
// shared pages in both views, the guides and the configure pages; the animations and the
// stylesheet (spec 010a).
export function siteFiles(input: SiteInput): readonly SiteFile[] {
  const b = built(input);
  const processes = [...input.processes].sort(
    (left, right) => left.order - right.order || left.title.localeCompare(right.title),
  );
  const guide = input.config.employees;
  const homes: readonly SiteFile[] =
    guide === undefined
      ? [{ path: "index.html", content: indexHtml(b, processes) }]
      : [
          { path: "index.html", content: frontDoorHtml(b, guide) },
          { path: EMPLOYEES_HOME, content: employeesHomeHtml(b, guide, processes) },
          { path: IT_HOME, content: indexHtml(b, processes, IT_HOME) },
        ];
  const files: SiteFile[] = [
    ...homes,
    { path: "assets/site.css", content: SITE_STYLE },
    ...processes.flatMap((process) => processFiles(b, process)),
  ];
  for (const scene of input.scenes) {
    const media = input.media?.get(scene.name);
    files.push({
      path: `animations/${scene.name}.html`,
      content: playerHtml(scene, media?.player),
    });
    if (media !== undefined) {
      files.push({ path: `animations/${scene.name}.mp3`, content: media.mp3 });
    }
    const video = input.videos?.get(scene.name);
    if (video !== undefined) {
      files.push({ path: `animations/${scene.name}.mp4`, content: video });
    }
  }
  return files;
}
