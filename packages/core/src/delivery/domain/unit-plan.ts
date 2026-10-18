import type { Difference } from "../../authoring/domain/compare";
import { knownLoss, type LossId, lossSets } from "../../authoring/domain/losses";
import type { UnitDecision } from "../../authoring/domain/plan-unit";
import type { BuiltUnit } from "../../authoring/domain/unit";
import { canonicalJson } from "../../kernel/canonical-json";
import { sha256Hex } from "../../kernel/sha256";
import type { GateResult } from "./gate";

// What a plan does with each unit of the workspace's Fluent source (ADR-0033 item 4).

export type UnitOperation = "create" | "load" | "delete" | "record";

export interface PlannedUnit {
  readonly project: string;
  readonly scope: string;
  readonly scopeId: string;
  readonly updateName: string;
  // The built file a load sends, relative to the build output.
  readonly file: string;
  readonly table: string;
  readonly sysId: string;
  readonly name: string;
  readonly operation: UnitOperation;
  // What the load changes: fields of the head (table.field), or a composite's rows (table rows).
  readonly changes: readonly string[];
  // Known SDK losses the load also sets.
  readonly losses: readonly LossId[];
  // What those losses set, as table.field = value (or table rows): shown in every plan.
  readonly alsoSets: readonly string[];
  readonly digest: string;
  // The ledger's instance version, and the instance's now (null for a unit it does not hold).
  readonly ledger: string | null;
  readonly version: string | null;
  // For a deletion: the update name of the record it deletes, whose ledger entry push removes.
  readonly removes: string | null;
}

export type UnitProblemKind = "drift" | "not-adopted" | "unsafe" | "removed" | "build";

export interface UnitProblem {
  readonly project: string;
  readonly updateName: string;
  readonly kind: UnitProblemKind;
  readonly reason: string;
}

const NAME_FIELDS = ["sys_name", "name", "api_name", "element", "title"];

export function unitName(unit: BuiltUnit): string {
  for (const field of NAME_FIELDS) {
    const value = unit.head.fields[field]?.trim();
    if (value) return value;
  }
  return unit.updateName;
}

// A record unit is named <table>_<sys_id>; units named by their keys (dictionary entries,
// layouts) are not.
const RECORD_UNIT = /^([a-z0-9_]+)_([0-9a-f]{32})$/;

// The line that deletes a removed unit's record, by sys_id: deleting by keys gives the deletion
// a sys_id of its own (S16 F3). Null for a unit named by its keys.
export function deletionFor(updateName: string): string | null {
  const match = RECORD_UNIT.exec(updateName);
  return match === null ? null : `Now.del('${match[1]}', '${match[2]}')`;
}

const scopeOf = (unit: BuiltUnit) => unit.head.fields["sys_scope"];

// The differences the source makes, and what the SDK sets beyond it (its known losses).
const authored = (differences: readonly Difference[], scope: string | undefined) =>
  differences.filter((difference) => knownLoss(difference, scope) === null);

export const changesOf = (differences: readonly Difference[]): string[] => [
  ...new Set(
    differences.map((d) => (d.kind === "field" ? `${d.table}.${d.field}` : `${d.table} rows`)),
  ),
];

const REASONS: Readonly<Record<"drift" | "not-adopted", string>> = {
  drift:
    "changed on the instance since it last agreed with source: run snagentic adopt --refresh, then plan again",
  "not-adopted":
    "the instance holds it and this branch never adopted it: run snagentic adopt first, so source starts from the instance's copy",
};

// A decision as a plan entry, or as the problem that keeps the plan from being ready.
export function plannedOrProblem(
  decision: UnitDecision,
  unit: BuiltUnit,
  context: Omit<
    PlannedUnit,
    | "updateName"
    | "file"
    | "table"
    | "sysId"
    | "name"
    | "operation"
    | "changes"
    | "losses"
    | "alsoSets"
  >,
): PlannedUnit | UnitProblem | null {
  const problem = (kind: UnitProblemKind, reason: string): UnitProblem => ({
    project: context.project,
    updateName: unit.updateName,
    kind,
    reason,
  });
  if (decision.kind === "none") return null;
  if (decision.kind === "drift" || decision.kind === "not-adopted") {
    return problem(decision.kind, REASONS[decision.kind]);
  }
  if (decision.kind === "unsafe")
    return problem("unsafe", `${decision.reason}: it is never loaded`);
  return {
    ...context,
    updateName: unit.updateName,
    file: unit.file,
    table: unit.head.table,
    sysId: unit.head.sysId,
    name: unitName(unit),
    operation: decision.kind,
    changes:
      decision.kind === "load" ? changesOf(authored(decision.differences, scopeOf(unit))) : [],
    losses: decision.kind === "load" ? decision.losses : [],
    alsoSets: decision.kind === "load" ? lossSets(decision.differences, scopeOf(unit)) : [],
  };
}

// Binds a plan to exactly what it would load, against which instance versions, under which
// gate: any edit, any save on the instance, any finding or waiver gives another id.
export function unitPlanId(units: readonly PlannedUnit[], gate: GateResult): string {
  const material = canonicalJson({
    // A deletion's update name holds a random sys_id: it is bound by what it deletes.
    units: units.map((u) =>
      [
        u.project,
        u.operation === "delete" ? `${u.table} ${u.removes ?? ""}` : u.updateName,
        u.operation,
        u.digest,
        u.ledger ?? "",
        u.version ?? "",
      ].join(" "),
    ),
    gate: {
      passed: gate.passed,
      blocking: gate.blocking.map((f) => `${f.ruleId} ${f.path}:${f.line ?? ""}`),
      waived: gate.waived.map((f) => `${f.ruleId} ${f.path}:${f.line ?? ""} ${f.approver}`),
    },
  });
  return sha256Hex(material).slice(0, 16);
}
