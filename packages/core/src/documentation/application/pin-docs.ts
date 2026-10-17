import type { DocsCheck } from "./check-docs";
import { assessDocumentation, type CheckDocsDependencies } from "./check-docs";
import { loadDocumentation } from "./load-documentation";

export interface PinDocsQuery {
  // Only this page (its path under documentation/), or the pages of a process or of one
  // capability (<process> or <process>/<capability>); all pages when absent.
  readonly page?: string;
}

export interface PinDocsResult {
  readonly pinned: readonly {
    readonly page: string;
    readonly id: string;
    readonly anchor: string;
  }[];
  // Evidence whose record is gone: nothing to pin, the claim must be rewritten.
  readonly missing: readonly {
    readonly page: string;
    readonly id: string;
    readonly anchor: string;
  }[];
}

const pinnable = (check: DocsCheck) =>
  check.evidence.filter((item) => item.status === "changed" || item.status === "unpinned");

// `docs pin`: after the author has re-verified the claims, records the mirror's current hashes
// so the next check compares with them.
export async function pinDocs(
  deps: CheckDocsDependencies,
  query: PinDocsQuery,
): Promise<PinDocsResult> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  const selected =
    query.page === undefined
      ? docs.pages
      : docs.pages.filter(
          (page) =>
            page.path === query.page ||
            page.process === query.page ||
            `${page.process}/${page.capability}` === query.page,
        );
  const check = await assessDocumentation(
    { ...docs, pages: selected },
    deps.mirror(docs.config.instance),
    deps.signal,
  );
  const toPin = pinnable(check);
  for (const page of selected) {
    const hashes = new Map<string, string>();
    for (const item of toPin.filter((candidate) => candidate.page === page.path)) {
      if (item.current !== null) {
        hashes.set(item.id, item.current);
      }
    }
    if (hashes.size > 0) {
      await deps.sources.pinHashes(page.path, hashes);
    }
  }
  const brief = ({ page, id, anchor }: { page: string; id: string; anchor: string }) => ({
    page,
    id,
    anchor,
  });
  return {
    pinned: toPin.map(brief),
    missing: check.evidence.filter((item) => item.status === "missing").map(brief),
  };
}
