import {
  anchorHash,
  anchorOf,
  type EvidenceStatus,
  evidenceStatus,
  seenStatus,
} from "../domain/evidence";
import { undecided } from "../domain/features";
import type { DocPage } from "../domain/page";
import { questionProblems } from "../domain/question-checks";
import { type DocsProblem, docsProblem, structureProblems } from "../domain/structure";
import type { DocumentationSources, MirrorRecords } from "../ports";
import { takeCensus } from "./census";
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

// What an open question is about, against the mirror (ADR-0041): when it changed, the instance
// may have answered the question.
export interface QuestionAnchorResult {
  // processes/<process>/questions.yaml
  readonly path: string;
  // <question id>#<index of the anchor>
  readonly key: string;
  readonly anchor: string;
  readonly status: EvidenceStatus;
  readonly current: string | null;
}

export interface DocsCheck {
  readonly instance: string;
  readonly processes: number;
  readonly pages: number;
  readonly animations: number;
  readonly evidence: readonly EvidenceResult[];
  readonly questionAnchors?: readonly QuestionAnchorResult[];
  readonly problems: readonly DocsProblem[];
  // False when evidence is changed or missing, or a source has an error.
  readonly ok: boolean;
}

async function verify(page: DocPage, mirror: MirrorRecords, today: string, signal: AbortSignal) {
  const results: EvidenceResult[] = [];
  for (const item of page.evidence) {
    signal.throwIfAborted();
    const anchor = anchorOf(item);
    if (item.kind !== "record") {
      const status = item.kind === "seen" ? seenStatus(item, today) : "answered";
      results.push({ page: page.path, id: item.id, anchor, status, current: null });
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

async function verifyQuestions(docs: Documentation, mirror: MirrorRecords, signal: AbortSignal) {
  const results: QuestionAnchorResult[] = [];
  for (const declared of docs.questions) {
    for (const question of declared.questions.filter((item) => item.status === "open")) {
      for (const [index, item] of question.about.entries()) {
        signal.throwIfAborted();
        const current = anchorHash(item, await mirror.read(item.table, item.sysId));
        results.push({
          path: declared.path,
          key: `${question.id}#${index}`,
          anchor: anchorOf(item),
          status: evidenceStatus(item, current),
          current,
        });
      }
    }
  }
  return results;
}

const mootProblems = (anchors: readonly QuestionAnchorResult[]) =>
  anchors
    .filter((item) => item.status === "changed" || item.status === "missing")
    .map((item) =>
      docsProblem("question-may-be-moot", item.path, `${item.key} ${item.anchor} ${item.status}`),
    );

// Are the pages still true? Every piece of evidence against the mirror, and the sources'
// structure: citations, animations, sections, audiences, counterparts (ADR-0036, spec 010a).
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
  const questionAnchors = await verifyQuestions(docs, mirror, signal);
  const problems = [
    ...structureProblems(docs),
    ...questionProblems(docs),
    ...mootProblems(questionAnchors),
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
    questionAnchors,
    problems,
    ok: !stale && !problems.some((problem) => problem.severity === "error"),
  };
}

export const todayOf = (clock: () => Date) => clock().toISOString().slice(0, 10);

// Applications the census finds that no feature names, for each process with a features.yaml
// (ADR-0040). Only docs check runs the census: it reads the whole mirror's dictionary.
async function undecidedProblems(
  docs: Documentation,
  mirror: MirrorRecords,
  signal: AbortSignal,
): Promise<readonly DocsProblem[]> {
  const problems: DocsProblem[] = [];
  for (const declared of docs.features) {
    const process = docs.processes.find((item) => item.id === declared.process);
    if (process === undefined) continue;
    for (const group of undecided(await takeCensus(process, mirror, signal), declared)) {
      const what = group.items
        .map(
          (item) =>
            `${item.kind.toLowerCase()}: ${item.names.slice(0, 3).join(", ")}${item.names.length > 3 ? ", …" : ""}`,
        )
        .join("; ");
      problems.push(
        docsProblem("undecided-feature", declared.path, `${group.scope} (${group.title}): ${what}`),
      );
    }
  }
  return problems;
}

export async function checkDocs(deps: CheckDocsDependencies): Promise<DocsCheck> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  const mirror = deps.mirror(docs.config.instance);
  const check = await assessDocumentation(docs, mirror, todayOf(deps.clock), deps.signal);
  return {
    ...check,
    problems: [...check.problems, ...(await undecidedProblems(docs, mirror, deps.signal))],
  };
}
