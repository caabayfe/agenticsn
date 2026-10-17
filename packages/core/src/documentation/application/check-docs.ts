import { anchorHash, anchorOf, type EvidenceStatus, evidenceStatus } from "../domain/evidence";
import { type DocPage, type PageProblem, pageProblems } from "../domain/page";
import { OVERVIEW } from "../domain/process";
import { animationsOf } from "../domain/prose";
import type { DocumentationSources, MirrorRecords } from "../ports";
import { type Documentation, loadDocumentation } from "./load-documentation";

export interface CheckDocsDependencies {
  readonly sources: DocumentationSources;
  // The mirror of the instance named in site.yaml.
  readonly mirror: (instance: string) => MirrorRecords;
  readonly root: string;
  readonly signal: AbortSignal;
}

export interface EvidenceResult {
  readonly page: string;
  readonly id: string;
  readonly anchor: string;
  readonly status: EvidenceStatus;
  // The mirror's hash now, to pin; null when the record is gone.
  readonly current: string | null;
}

export interface DocsProblem {
  readonly kind:
    | PageProblem["kind"]
    | "unknown-animation"
    | "unknown-process"
    | "unknown-capability"
    | "missing-guide";
  readonly page: string;
  readonly detail: string;
}

export interface DocsCheck {
  readonly instance: string;
  readonly processes: number;
  readonly pages: number;
  readonly animations: number;
  readonly evidence: readonly EvidenceResult[];
  readonly problems: readonly DocsProblem[];
  // False when evidence is changed or missing, or a page cites what doesn't exist.
  readonly ok: boolean;
}

const BLOCKING: readonly DocsProblem["kind"][] = [
  "unknown-citation",
  "unknown-animation",
  "unknown-process",
  "unknown-capability",
];

async function verify(page: DocPage, mirror: MirrorRecords, signal: AbortSignal) {
  const results: EvidenceResult[] = [];
  for (const item of page.evidence) {
    signal.throwIfAborted();
    const current = anchorHash(item, await mirror.read(item.table, item.sysId));
    results.push({
      page: page.path,
      id: item.id,
      anchor: anchorOf(item),
      status: evidenceStatus(item, current),
      current,
    });
  }
  return results;
}

function placement(docs: Documentation, page: DocPage): readonly DocsProblem[] {
  const process = docs.processes.find((candidate) => candidate.id === page.process);
  if (process === undefined) {
    return [{ kind: "unknown-process", page: page.path, detail: page.process }];
  }
  const known =
    page.capability === OVERVIEW ||
    process.capabilities.some((item) => item.id === page.capability);
  return known ? [] : [{ kind: "unknown-capability", page: page.path, detail: page.capability }];
}

function references(docs: Documentation): readonly DocsProblem[] {
  const names = new Set(docs.scenes.map((scene) => scene.name));
  const guides = new Set(
    docs.pages
      .filter((page) => page.audience === "guide")
      .map((page) => `${page.process}/${page.capability}`),
  );
  const missing = docs.processes.flatMap((process) =>
    process.capabilities
      .filter((capability) => !guides.has(`${process.id}/${capability.id}`))
      .map((capability) => ({
        kind: "missing-guide" as const,
        page: `processes/${process.id}/process.yaml`,
        detail: capability.id,
      })),
  );
  return [
    ...docs.pages.flatMap((page) => [
      ...placement(docs, page),
      ...animationsOf(page.body)
        .filter((name) => !names.has(name))
        .map((name) => ({ kind: "unknown-animation" as const, page: page.path, detail: name })),
    ]),
    ...missing,
  ];
}

// Are the pages still true? Every piece of evidence against the mirror, every citation,
// animation and pair against the sources (ADR-0034).
export async function assessDocumentation(
  docs: Documentation,
  mirror: MirrorRecords,
  signal: AbortSignal,
): Promise<DocsCheck> {
  const evidence: EvidenceResult[] = [];
  for (const page of docs.pages) {
    evidence.push(...(await verify(page, mirror, signal)));
  }
  const problems = [...docs.pages.flatMap(pageProblems), ...references(docs)];
  const stale = evidence.some((item) => item.status === "changed" || item.status === "missing");
  return {
    instance: docs.config.instance,
    processes: docs.processes.length,
    pages: docs.pages.length,
    animations: docs.scenes.length,
    evidence,
    problems,
    ok: !stale && !problems.some((problem) => BLOCKING.includes(problem.kind)),
  };
}

export async function checkDocs(deps: CheckDocsDependencies): Promise<DocsCheck> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  return assessDocumentation(docs, deps.mirror(docs.config.instance), deps.signal);
}
