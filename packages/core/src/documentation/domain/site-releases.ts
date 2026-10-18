import type { Release, ReleaseNote } from "./releases";
import type { Built } from "./site-context";
import { WHATS_NEW_EMPLOYEES, WHATS_NEW_IT } from "./site-layout";

// Which release notes each What's new page shows (ADR-0039): employees see theirs, IT every note.

export type NotesPage = "employees" | "it";

export const shown = (page: NotesPage, note: ReleaseNote) =>
  page === "it" || note.guide === "employees";

// The releases with notes for this page, newest first.
export function releasesFor(b: Built, page: NotesPage): readonly Release[] {
  return [...(b.input.releases ?? [])]
    .filter((release) => release.notes.some((note) => shown(page, note)))
    .sort(
      (left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title),
    );
}

// The guide's What's new page, or null when no note is for it. Without an employee guide, the
// one guide is the IT guide.
export function whatsNewOf(b: Built, page: NotesPage): string | null {
  if (page === "employees" && b.input.config.employees === undefined) return null;
  if (releasesFor(b, page).length === 0) return null;
  return page === "employees" ? WHATS_NEW_EMPLOYEES : WHATS_NEW_IT;
}
