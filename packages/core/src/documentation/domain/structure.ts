import { checkedOnSurface, platformWords } from "./audience-checks";
import { unknownGuidePages } from "./employee-guide";
import { type DocPage, type PageProblem, pageProblems, type Section } from "./page";
import type { Process, ProcessCapability } from "./process";
import { animationsOf } from "./prose";
import { referencesOf, resolveReference } from "./references";
import type { Scene } from "./scene";
import type { SiteConfig } from "./site-config";
import { type View, viewOf } from "./views";

// Everything under documentation/, parsed.
export interface DocSet {
  readonly config: SiteConfig;
  readonly processes: readonly Process[];
  readonly pages: readonly DocPage[];
  readonly scenes: readonly Scene[];
}

const ERRORS = [
  "unknown-citation",
  "misplaced-view",
  "unknown-view",
  "unknown-animation",
  "unknown-process",
  "unknown-capability",
  "unknown-topic",
  "wrong-section",
  "mixed-audience",
  "bad-counterpart",
  "missing-configure",
  "unknown-reference",
  "missing-animation",
  "unknown-guide-page",
] as const;
const WARNINGS = [
  "uncited-evidence",
  "no-evidence",
  "misplaced-label",
  "missing-page",
  "unused-role",
  "platform-words",
  "unchecked-surface",
  "recheck-seen",
] as const;
export const DOCS_PROBLEM_KINDS = [...ERRORS, ...WARNINGS] as const;
export type DocsProblemKind = (typeof DOCS_PROBLEM_KINDS)[number];

export interface DocsProblem {
  readonly kind: DocsProblemKind;
  // An error fails `docs check`; a warning is reported only.
  readonly severity: "error" | "warning";
  readonly page: string;
  readonly detail: string;
}

export function docsProblem(kind: DocsProblemKind, page: string, detail: string): DocsProblem {
  const severity = (ERRORS as readonly string[]).includes(kind) ? "error" : "warning";
  return { kind, severity, page, detail };
}

const fromPage = (problem: PageProblem) => docsProblem(problem.kind, problem.page, problem.detail);

export const SECTION_VIEW: Readonly<Partial<Record<Section, View>>> = {
  use: "user",
  operate: "operator",
};
const VIEW_SECTION: Readonly<Record<View, Section>> = { user: "use", operator: "operate" };

// The reader of a capability, from its roles; "mixed" when they span both, null with no roles.
export function capabilityAudience(
  process: Process,
  capability: ProcessCapability,
): View | "mixed" | null {
  const audiences = new Set(
    capability.roles.map((id) => process.roles.find((role) => role.id === id)?.audience),
  );
  audiences.delete(undefined);
  if (audiences.size > 1) {
    return "mixed";
  }
  return [...audiences][0] ?? null;
}

function placement(docs: DocSet, page: DocPage): readonly DocsProblem[] {
  const process = docs.processes.find((candidate) => candidate.id === page.process);
  if (process === undefined) {
    return [docsProblem("unknown-process", page.path, page.process)];
  }
  if (page.section === "understand") {
    const listed = process.understand.length === 0 || process.understand.includes(page.topic);
    return listed ? [] : [docsProblem("unknown-topic", page.path, page.topic)];
  }
  const view = SECTION_VIEW[page.section];
  if (view === undefined) {
    return [];
  }
  const capability = process.capabilities.find((item) => item.id === page.topic);
  if (capability === undefined) {
    return [docsProblem("unknown-capability", page.path, page.topic)];
  }
  const audience = capabilityAudience(process, capability);
  return audience === null || audience === view || audience === "mixed"
    ? []
    : [docsProblem("wrong-section", page.path, `${page.topic} is for ${audience}s`)];
}

function counterpartProblems(process: Process, capability: ProcessCapability, at: string) {
  if (capability.counterpart === undefined) {
    return [];
  }
  const other = process.capabilities.find((item) => item.id === capability.counterpart);
  const fine =
    other !== undefined &&
    other.counterpart === capability.id &&
    capabilityAudience(process, other) !== capabilityAudience(process, capability);
  return fine
    ? []
    : [docsProblem("bad-counterpart", at, `${capability.id} → ${capability.counterpart}`)];
}

function capabilityProblems(docs: DocSet, process: Process, capability: ProcessCapability) {
  const at = `processes/${process.id}/process.yaml`;
  const has = (section: Section, topic: string) =>
    docs.pages.some(
      (page) => page.process === process.id && page.section === section && page.topic === topic,
    );
  const audience = capabilityAudience(process, capability);
  if (audience === "mixed") {
    return [docsProblem("mixed-audience", at, capability.id)];
  }
  const problems = counterpartProblems(process, capability, at);
  const configure = capability.configure ?? capability.id;
  if (
    (audience === "operator" || capability.configure !== undefined) &&
    !has("configure", configure)
  ) {
    problems.push(
      docsProblem("missing-configure", at, `${capability.id} → configure/${configure}.md`),
    );
  }
  if (audience !== null && !has(VIEW_SECTION[audience], capability.id)) {
    problems.push(docsProblem("missing-page", at, `${VIEW_SECTION[audience]}/${capability.id}.md`));
  }
  return problems;
}

function processProblems(docs: DocSet, process: Process): readonly DocsProblem[] {
  const at = `processes/${process.id}/process.yaml`;
  const understood = new Set(
    docs.pages
      .filter((page) => page.process === process.id && page.section === "understand")
      .map((page) => page.topic),
  );
  const used = new Set(process.capabilities.flatMap((capability) => capability.roles));
  return [
    ...process.capabilities.flatMap((capability) => capabilityProblems(docs, process, capability)),
    ...process.understand
      .filter((topic) => !understood.has(topic))
      .map((topic) => docsProblem("missing-page", at, `understand/${topic}.md`)),
    ...process.roles
      .filter((role) => !used.has(role.id))
      .map((role) => docsProblem("unused-role", at, role.id)),
  ];
}

// End users shouldn't meet platform words, and every guide should rest on the reader's screen.
function audienceProblems(docs: DocSet, page: DocPage): readonly DocsProblem[] {
  const userText =
    page.section === "use"
      ? page.body
      : page.section === "understand"
        ? viewOf(page.body, "user")
        : null;
  const words = userText === null ? [] : platformWords(userText, docs.config.vocabulary);
  const problems =
    words.length === 0 ? [] : [docsProblem("platform-words", page.path, words.join(", "))];
  const view = SECTION_VIEW[page.section];
  // Every capability is shown, not only told (spec 010c): a guide without an animation fails.
  if (view !== undefined && animationsOf(page.body).length === 0) {
    problems.push(docsProblem("missing-animation", page.path, page.topic));
  }
  if (view !== undefined && !checkedOnSurface(page.evidence, view)) {
    problems.push(
      docsProblem("unchecked-surface", page.path, `no evidence from the ${view}'s screens`),
    );
  }
  return problems;
}

// What `docs check` finds in the sources alone, before the mirror is read.
export function structureProblems(docs: DocSet): readonly DocsProblem[] {
  const names = new Set(docs.scenes.map((scene) => scene.name));
  const processIds = docs.processes.map((process) => process.id);
  return [
    ...docs.pages.flatMap((page) => [
      ...pageProblems(page).map(fromPage),
      ...placement(docs, page),
      ...animationsOf(page.body)
        .filter((name) => !names.has(name))
        .map((name) => docsProblem("unknown-animation", page.path, name)),
      ...referencesOf(page.body)
        .filter((target) => resolveReference(target, page, docs.pages, processIds) === null)
        .map((target) => docsProblem("unknown-reference", page.path, `see:${target}`)),
      ...audienceProblems(docs, page),
    ]),
    ...docs.processes.flatMap((process) => processProblems(docs, process)),
    ...unknownGuidePages(docs.config.employees, docs.pages).map((target) =>
      docsProblem("unknown-guide-page", "site.yaml", target),
    ),
  ];
}
