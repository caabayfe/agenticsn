import { DocumentationSourceError } from "./errors";
import { fieldsOf, textOf } from "./fields";
import type { DocPage, Section } from "./page";
import { resolveReference } from "./references";

// What changed for readers, one file per release (ADR-0039, decision 6):
// documentation/changes/<release>.md, with a title, a date, notes for employees or for IT, each
// linking its pages with see: references, and an optional introduction as the body.

export const NOTE_GUIDES = ["employees", "it"] as const;
export type NoteGuide = (typeof NOTE_GUIDES)[number];

export interface ReleaseNote {
  readonly guide: NoteGuide;
  readonly note: string;
  readonly see: readonly string[];
}

export interface Release {
  // Relative to documentation/: changes/<release>.md.
  readonly path: string;
  readonly title: string;
  // YYYY-MM-DD.
  readonly date: string;
  readonly intro: string;
  readonly notes: readonly ReleaseNote[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isGuide = (value: string | undefined): value is NoteGuide =>
  (NOTE_GUIDES as readonly (string | undefined)[]).includes(value);

function noteOf(path: string, raw: unknown, index: number): ReleaseNote {
  const fields = fieldsOf(raw);
  const guide = textOf(fields["for"]);
  if (!isGuide(guide)) {
    throw new DocumentationSourceError(path, `note ${index + 1}: for must be employees or it`);
  }
  const note = textOf(fields["note"]);
  if (note === undefined) {
    throw new DocumentationSourceError(path, `note ${index + 1}: needs note, the change in words`);
  }
  const see = Array.isArray(fields["see"]) ? fields["see"] : [];
  return { guide, note, see: see.flatMap((item) => textOf(item) ?? []) };
}

export function parseRelease(
  path: string,
  source: { readonly frontMatter: unknown; readonly body: string },
): Release {
  const fields = fieldsOf(source.frontMatter);
  const title = textOf(fields["title"]);
  if (title === undefined) {
    throw new DocumentationSourceError(path, "front matter needs title");
  }
  const raw = fields["date"];
  const date = raw instanceof Date ? raw.toISOString().slice(0, 10) : textOf(raw);
  if (date === undefined || !DATE.test(date)) {
    throw new DocumentationSourceError(path, "front matter needs date (YYYY-MM-DD)");
  }
  const notes = Array.isArray(fields["notes"]) ? fields["notes"] : [];
  return {
    path,
    title,
    date,
    intro: source.body,
    notes: notes.map((note, index) => noteOf(path, note, index)),
  };
}

// An employee note links the employee's page first, an IT note the operator's.
const FROM: Readonly<Record<NoteGuide, Section>> = { employees: "use", it: "operate" };

export function notePages(
  note: ReleaseNote,
  pages: readonly DocPage[],
  processes: readonly string[],
): readonly { readonly target: string; readonly page: DocPage | null }[] {
  return note.see.map((target) => {
    const resolved = resolveReference(
      target,
      { process: "", section: FROM[note.guide] },
      pages,
      processes,
    );
    return { target, page: resolved?.kind === "page" ? resolved.page : null };
  });
}

// Each see: reference of a note that leads to no page, by release file.
export function unknownReleasePages(
  releases: readonly Release[],
  pages: readonly DocPage[],
  processes: readonly string[],
): readonly { readonly path: string; readonly target: string }[] {
  return releases.flatMap((release) =>
    release.notes.flatMap((note) =>
      notePages(note, pages, processes)
        .filter((item) => item.page === null)
        .map((item) => ({ path: release.path, target: item.target })),
    ),
  );
}

// Pages whose evidence was pinned again to a new hash since `before`: the record they cite
// changed, and the page was checked again.
export function repinnedPages(
  now: readonly DocPage[],
  before: readonly DocPage[],
): readonly { readonly page: DocPage; readonly evidence: readonly string[] }[] {
  const earlier = new Map(before.map((page) => [page.path, page]));
  return now.flatMap((page) => {
    const hashes = new Map(
      (earlier.get(page.path)?.evidence ?? []).flatMap((item) =>
        item.kind === "record" && item.hash !== undefined ? [[item.id, item.hash]] : [],
      ),
    );
    const evidence = page.evidence.flatMap((item) => {
      const was = hashes.get(item.id);
      const now = item.kind === "record" ? item.hash : undefined;
      return was !== undefined && now !== undefined && now !== was ? [item.id] : [];
    });
    return evidence.length === 0 ? [] : [{ page, evidence }];
  });
}

// Notes in the releases now that the same release file didn't hold before.
export function newNotes(
  now: readonly Release[],
  before: readonly Release[],
): readonly ReleaseNote[] {
  const key = (path: string, note: ReleaseNote) => `${path}\n${note.guide}\n${note.note}`;
  const known = new Set(
    before.flatMap((release) => release.notes.map((n) => key(release.path, n))),
  );
  return now.flatMap((release) => release.notes.filter((n) => !known.has(key(release.path, n))));
}

export function notedPages(
  notes: readonly ReleaseNote[],
  pages: readonly DocPage[],
  processes: readonly string[],
): ReadonlySet<string> {
  return new Set(
    notes.flatMap((note) =>
      notePages(note, pages, processes).flatMap((item) => item.page?.path ?? []),
    ),
  );
}
