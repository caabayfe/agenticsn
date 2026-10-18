import { DocumentationSourceError } from "../domain/errors";
import { type DocPage, parseDocPage } from "../domain/page";
import {
  newNotes,
  notedPages,
  parseRelease,
  type Release,
  repinnedPages,
} from "../domain/releases";
import type { DocSet } from "../domain/structure";
import type { DocumentationHistory, PageSource } from "../ports";

// A file as `base` held it, or nothing when it didn't parse then: only the current sources must
// be valid.
function parsedAt<T>(sources: readonly PageSource[], parse: (source: PageSource) => T): T[] {
  return sources.flatMap((source) => {
    try {
      return [parse(source)];
    } catch (error) {
      if (error instanceof DocumentationSourceError) return [];
      throw error;
    }
  });
}

// Pages pinned again to a new hash since `base` that no release note added since `base` links
// (ADR-0039, decision 6): readers were told something new and nobody said so.
export async function unnotedPages(
  docs: DocSet,
  history: DocumentationHistory,
  base: string,
): Promise<readonly { readonly page: DocPage; readonly evidence: readonly string[] }[]> {
  const changed = new Set(await history.changedSince(base));
  const candidates = docs.pages.filter((page) => changed.has(page.path));
  if (candidates.length === 0) return [];
  const before = parsedAt(
    await history.at(
      base,
      candidates.map((page) => page.path),
    ),
    (source) => parseDocPage(source.path, source),
  );
  const repinned = repinnedPages(candidates, before);
  if (repinned.length === 0) return [];
  const earlier: Release[] = parsedAt(
    await history.at(
      base,
      docs.releases.map((release) => release.path),
    ),
    (source) => parseRelease(source.path, source),
  );
  const processes = docs.processes.map((process) => process.id);
  const noted = notedPages(newNotes(docs.releases, earlier), docs.pages, processes);
  return repinned.filter((item) => !noted.has(item.page.path));
}
