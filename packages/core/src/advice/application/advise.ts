import { type BehaviorItem, describeTable } from "../../knowledge/application/describe-table";
import { freshness } from "../../knowledge/application/freshness";
import type {
  Freshness,
  KnowledgeDependencies,
  NextCall,
} from "../../knowledge/application/knowledge-dependencies";
import { type Guidance, guidanceFor, type WorkPhase } from "../domain/guidance";
import type { Customization, Intent, Option } from "../domain/intents";
import { recognise } from "../domain/intents";
import { type Rule, rulesFor } from "../domain/rules";

export interface AdviseQuery {
  readonly intent: string;
  // Tables the work is about (record paths are described with describe, not here).
  readonly targets: readonly string[];
  readonly phase: WorkPhase;
  // build and review: the classes being changed, when known.
  readonly classes?: readonly string[];
}

export type Fit = "likely" | "possible" | "last resort";

export interface LadderStep {
  readonly option: string;
  readonly customization: Customization;
  readonly classes: readonly string[];
  readonly when: string;
  readonly fit: Fit;
  // What already exists on the targets for this option.
  readonly evidence: string | null;
}

export interface TableFacts {
  readonly table: string;
  readonly known: boolean;
  readonly inherits: readonly string[];
  // Active behavior per phase, inherited included.
  readonly counts: Readonly<Record<string, number>>;
  // Existing behavior in the phases the options touch, first items of each.
  readonly related: readonly BehaviorItem[];
}

export interface Advice extends Freshness {
  readonly intents: readonly { readonly id: string; readonly label: string }[];
  readonly ladder: readonly LadderStep[];
  readonly facts: readonly TableFacts[];
  readonly guidance: readonly Guidance[];
  readonly rules: readonly Rule[];
  readonly designRecord: string | null;
  readonly next: readonly NextCall[];
}

const RELATED_PER_PHASE = 5;

export const DESIGN_RECORD = [
  "Requirement:        <one line>",
  "Option chosen:      <configuration | low-code | script> and why",
  "Options rejected:   <each, with the reason>",
  "Scope:              <application scope or global, and why>",
  "Records to change:  <table / name / create|update>, noting any out-of-box record",
  "Security:           <ACLs and roles affected>",
  "Performance:        <synchronous or async, query volume>",
  "Upgrade impact:     <baseline records customized, if any>",
  "Test approach:      <ATF test or manual steps>",
].join("\n");

// Least custom first: the first non-script option is likely, other non-script options
// possible, scripts a last resort when anything else exists.
function fitOf(option: Option, index: number, options: readonly Option[]): Fit {
  const hasDeclarative = options.some((o) => o.customization !== "script");
  if (option.customization === "script") {
    return hasDeclarative ? "last resort" : index === 0 ? "likely" : "possible";
  }
  return options.findIndex((o) => o.customization !== "script") === index ? "likely" : "possible";
}

function evidenceOf(option: Option, facts: readonly TableFacts[]): string | null {
  const phase = option.evidence;
  if (phase === undefined) {
    return null;
  }
  const found = facts
    .filter((f) => (f.counts[phase] ?? 0) > 0)
    .map((f) => `${f.counts[phase]} on ${f.table}`);
  return found.length === 0
    ? `none on ${facts.map((f) => f.table).join(", ") || "the targets"} yet`
    : `already: ${found.join(", ")} (${phase})`;
}

async function factsFor(
  deps: KnowledgeDependencies,
  table: string,
  phases: ReadonlySet<string>,
): Promise<TableFacts> {
  const described = await describeTable(deps, table);
  const related: BehaviorItem[] = [];
  for (const [phase, items] of Object.entries(described.behavior)) {
    if (phases.has(phase)) {
      related.push(...(items ?? []).slice(0, RELATED_PER_PHASE));
    }
  }
  return {
    table,
    known: described.known,
    inherits: described.inherits,
    counts: described.counts,
    related,
  };
}

function ladderOf(intents: readonly Intent[], facts: readonly TableFacts[]): LadderStep[] {
  return intents.flatMap((intent) =>
    intent.options.map((option, index) => ({
      option: option.option,
      customization: option.customization,
      classes: option.classes,
      when: option.when,
      fit: fitOf(option, index, intent.options),
      evidence: evidenceOf(option, facts),
    })),
  );
}

// What to do and how, for a request on some tables: the platform's options least custom
// first, what already runs there, and the guidance and rules that apply (design 3.3).
export async function advise(deps: KnowledgeDependencies, query: AdviseQuery): Promise<Advice> {
  const intents = recognise(query.intent);
  const phases = new Set(
    intents.flatMap((i) =>
      i.options.flatMap((o) => (o.evidence === undefined ? [] : [o.evidence])),
    ),
  );
  const facts = await Promise.all(query.targets.map((table) => factsFor(deps, table, phases)));
  const ladder = ladderOf(intents, facts);
  const considered = ladder
    .filter((step) => step.fit !== "last resort")
    .flatMap((step) => step.classes);
  const classes =
    query.classes !== undefined && query.classes.length > 0
      ? query.classes
      : [...new Set(considered)];
  const first = facts[0]?.related[0];
  return {
    ...freshness(deps),
    intents: intents.map((i) => ({ id: i.id, label: i.label })),
    ladder,
    facts,
    guidance: guidanceFor(
      query.phase,
      classes,
      intents.map((i) => i.id),
    ),
    rules: query.phase === "design" ? [] : rulesFor(classes),
    designRecord: query.phase === "design" ? DESIGN_RECORD : null,
    next:
      first === undefined
        ? query.targets.map((t) => ({ tool: "describe", args: { target: t } }))
        : [{ tool: "describe", args: { target: first.path } }],
  };
}
