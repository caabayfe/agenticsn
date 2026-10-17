import type { EvidenceStatus } from "../domain/evidence";
import { siteFiles } from "../domain/site";
import type { MarkdownRenderer, SiteOutput } from "../ports";
import { assessDocumentation, type CheckDocsDependencies, type DocsCheck } from "./check-docs";
import { loadDocumentation } from "./load-documentation";

export interface BuildSiteDependencies extends CheckDocsDependencies {
  readonly markdown: MarkdownRenderer;
  readonly output: SiteOutput;
  readonly clock: () => Date;
}

export interface BuildSiteResult {
  readonly root: string;
  readonly files: number;
  readonly check: DocsCheck;
}

function statusesByPage(check: DocsCheck): Map<string, Map<string, EvidenceStatus>> {
  const byPage = new Map<string, Map<string, EvidenceStatus>>();
  for (const item of check.evidence) {
    const page = byPage.get(item.page) ?? new Map<string, EvidenceStatus>();
    page.set(item.id, item.status);
    byPage.set(item.page, page);
  }
  return byPage;
}

// `docs build`: the static site, with each page's evidence status as of now. A stale page is
// built and says so; `docs check` is the gate.
export async function buildSite(deps: BuildSiteDependencies): Promise<BuildSiteResult> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  const mirror = deps.mirror(docs.config.instance);
  const check = await assessDocumentation(docs, mirror, deps.signal);
  const files = siteFiles({
    config: docs.config,
    pages: docs.pages,
    scenes: docs.scenes,
    statuses: statusesByPage(check),
    markdown: (source) => deps.markdown.html(source),
    builtAt: deps.clock().toISOString().slice(0, 10),
    mirrorCommit: await mirror.head(),
  });
  await deps.output.replace(files);
  return { root: deps.output.root, files: files.length, check };
}
