import type { DocsCheck } from "./check-docs";
import { assessDocumentation, type CheckDocsDependencies, todayOf } from "./check-docs";
import { loadDocumentation } from "./load-documentation";

export interface PinDocsQuery {
  // Only this page (its path under documentation/), or the pages of a process, of one topic in
  // every section, or of one section's topic (<process>, <process>/<topic>,
  // <process>/<section>/<topic>); all pages when absent.
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

// What open questions are about is pinned like evidence, so a later change is noticed.
async function pinQuestions(
  deps: CheckDocsDependencies,
  check: DocsCheck,
  query: PinDocsQuery,
): Promise<void> {
  const parts = query.page?.split("/") ?? [];
  const process = parts[0] === "processes" ? parts[1] : parts[0];
  const byFile = new Map<string, Map<string, string>>();
  for (const item of check.questionAnchors ?? []) {
    if (process !== undefined && !item.path.startsWith(`processes/${process}/`)) continue;
    if (item.current === null || (item.status !== "changed" && item.status !== "unpinned"))
      continue;
    const hashes = byFile.get(item.path) ?? new Map<string, string>();
    hashes.set(item.key, item.current);
    byFile.set(item.path, hashes);
  }
  for (const [path, hashes] of byFile) {
    await deps.sources.pinQuestions?.(path, hashes);
  }
}

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
            `${page.process}/${page.topic}` === query.page ||
            `${page.process}/${page.section}/${page.topic}` === query.page,
        );
  const check = await assessDocumentation(
    { ...docs, pages: selected },
    deps.mirror(docs.config.instance),
    todayOf(deps.clock),
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
  await pinQuestions(deps, check, query);
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
