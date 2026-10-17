import {
  anchorHash,
  anchorOf,
  type EvidenceStatus,
  evidenceStatus,
  seenStatus,
} from "../domain/evidence";
import type { DocPage } from "../domain/page";
import { type DocsProblem, docsProblem, structureProblems } from "../domain/structure";
import type { DocumentationSources, MirrorRecords } from "../ports";
import { type Documentation, loadDocumentation } from "./load-documentation";

export interface CheckDocsDependencies {
  readonly sources: DocumentationSources;
  // The mirror of the instance named in site.yaml.
  readonly mirror: (instance: string) => MirrorRecords;
  readonly root: string;
  readonly signal: AbortSignal;
  // Today, to know when a person's check of a screen is due again.
  readonly clock: () => Date;
}

export interface EvidenceResult {
  readonly page: string;
  readonly id: string;
  readonly anchor: string;
  readonly status: EvidenceStatus;
  // The mirror's hash now, to pin; null when the record is gone or the evidence was seen.
  readonly current: string | null;
}

export interface DocsCheck {
  readonly instance: string;
  readonly processes: number;
  readonly pages: number;
  readonly animations: number;
  readonly evidence: readonly EvidenceResult[];
  readonly problems: readonly DocsProblem[];
  // False when evidence is changed or missing, or a source has an error.
  readonly ok: boolean;
}

async function verify(page: DocPage, mirror: MirrorRecords, today: string, signal: AbortSignal) {
  const results: EvidenceResult[] = [];
  for (const item of page.evidence) {
    signal.throwIfAborted();
    const anchor = anchorOf(item);
    if (item.kind === "seen") {
      results.push({
        page: page.path,
        id: item.id,
        anchor,
        status: seenStatus(item, today),
        current: null,
      });
      continue;
    }
    const current = anchorHash(item, await mirror.read(item.table, item.sysId));
    results.push({
      page: page.path,
      id: item.id,
      anchor,
      status: evidenceStatus(item, current),
      current,
    });
  }
  return results;
}

// Are the pages still true? Every piece of evidence against the mirror, and the sources'
// structure: citations, animations, sections, audiences, counterparts (ADR-0034, spec 010a).
export async function assessDocumentation(
  docs: Documentation,
  mirror: MirrorRecords,
  today: string,
  signal: AbortSignal,
): Promise<DocsCheck> {
  const evidence: EvidenceResult[] = [];
  for (const page of docs.pages) {
    evidence.push(...(await verify(page, mirror, today, signal)));
  }
  const problems = [
    ...structureProblems(docs),
    ...evidence
      .filter((item) => item.status === "recheck")
      .map((item) => docsProblem("recheck-seen", item.page, `${item.id} ${item.anchor}`)),
  ];
  const stale = evidence.some((item) => item.status === "changed" || item.status === "missing");
  return {
    instance: docs.config.instance,
    processes: docs.processes.length,
    pages: docs.pages.length,
    animations: docs.scenes.length,
    evidence,
    problems,
    ok: !stale && !problems.some((problem) => problem.severity === "error"),
  };
}

export const todayOf = (clock: () => Date) => clock().toISOString().slice(0, 10);

export async function checkDocs(deps: CheckDocsDependencies): Promise<DocsCheck> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  return assessDocumentation(
    docs,
    deps.mirror(docs.config.instance),
    todayOf(deps.clock),
    deps.signal,
  );
}
