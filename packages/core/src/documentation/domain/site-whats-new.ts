import { escapeHtml } from "./html";
import { notePages, type Release, type ReleaseNote } from "./releases";
import { type Built, guideCrumbs, link } from "./site-context";
import { layout, pageFile, prefixOf } from "./site-layout";
import { navFor } from "./site-nav";
import { type NotesPage, releasesFor, shown, whatsNewOf } from "./site-releases";

// The What's new pages (ADR-0039, decision 6): the employee guide lists the notes for
// employees; the IT guide lists every note, the employees' marked, as IT answers their
// questions too. Newest release first.

function noteHtml(b: Built, page: NotesPage, file: string, note: ReleaseNote): string {
  const processes = b.input.processes.map((process) => process.id);
  const view = page === "employees" || note.guide === "employees" ? "user" : "operator";
  const links = notePages(note, b.input.pages, processes).flatMap((item) =>
    item.page === null ? [] : [link(prefixOf(file), pageFile(item.page, view), item.page.title)],
  );
  const tag =
    page === "it" && note.guide === "employees"
      ? '<span class="label label-new">For employees</span> '
      : "";
  const see = links.length === 0 ? "" : ` <span class="mute">· ${links.join(", ")}</span>`;
  return `<li>${tag}${escapeHtml(note.note)}${see}</li>`;
}

function releaseHtml(b: Built, page: NotesPage, file: string, release: Release) {
  const notes = release.notes.filter((note) => shown(page, note));
  const intro = release.intro.trim() === "" ? "" : b.input.markdown(release.intro);
  const items = notes.map((note) => noteHtml(b, page, file, note)).join("");
  return `<section class="release"><h2>${escapeHtml(release.title)}</h2><p class="mute">${escapeHtml(release.date)}</p>${intro}<ul>${items}</ul></section>`;
}

export function whatsNewHtml(b: Built, page: NotesPage, file: string): string {
  const lead =
    page === "employees"
      ? "What changed in how you get help from IT, newest first."
      : "What changed in the processes and their configuration, newest first. Notes for employees are marked.";
  const releases = releasesFor(b, page).map((release) => releaseHtml(b, page, file, release));
  const main = `<h1>What's new</h1>\n<p class="lead">${lead}</p>\n${releases.join("\n")}`;
  const crumbs = guideCrumbs(b, page === "employees" ? "user" : "platform");
  return layout(b.input.config, "What's new", file, crumbs, main, navFor(b, file));
}

export function whatsNewFiles(b: Built) {
  return (["employees", "it"] as const).flatMap((page) => {
    const file = whatsNewOf(b, page);
    return file === null ? [] : [{ path: file, content: whatsNewHtml(b, page, file) }];
  });
}
