import { canonicalJson } from "../../kernel/canonical-json";
import { sha256Hex } from "../../kernel/sha256";
import type { Selection } from "./capability-graph";
import type { OpenSet } from "./earlier-sets";
import type { EnsureFact } from "./ensure";
import type { Adoption } from "./materialize";
import type { ComponentCheck, PreflightReport } from "./preflight";
import type { FieldCheck } from "./required-fields";

// The install plan a platform admin approves by its id before anything changes (ADR-0038,
// items 2 and 3). Pure: built from the pack, the selection and the instance's mirrored facts.

// What the install does with one component, decided from its state on the instance.
export type ComponentAction =
  | "none"
  // An inactive plugin: activated through the platform's installer, waiting for it to finish.
  | "activate"
  // Nothing snagentic may do: the plan cannot run until it is resolved on the instance.
  | "blocked";

export interface PlannedComponent extends ComponentCheck {
  // The modules that need it.
  readonly modules: readonly string[];
  readonly action: ComponentAction;
  readonly reason: string;
}

export interface PlannedModule {
  readonly id: string;
  // Names the module's update sets ("snagentic: <label>", one child per scope).
  readonly label: string;
  // Workspace paths of the Fluent source the module writes.
  readonly files: readonly string[];
  // Out-of-box records the module customizes: listed for the admin, flagged for upgrades.
  readonly adoptions: readonly Adoption[];
  // Layouts the module adds to, found by table and view when it is delivered (ADR-0042).
  readonly ensures: readonly EnsureFact[];
}

export interface PlannedEntity {
  readonly entity: string;
  readonly module: string;
  readonly target: string | null;
  readonly rows: number;
  readonly anchors: boolean;
}

// A platform field a module reads, as the mirror shows it (plan gap G13).
export type PlannedField = FieldCheck;

export interface InstallPlan {
  readonly planId: string;
  readonly pack: string;
  readonly version: string;
  readonly instance: { readonly name: string; readonly kind: string };
  readonly selection: Selection;
  // Module ids, dependencies first.
  readonly modules: readonly PlannedModule[];
  readonly components: readonly PlannedComponent[];
  // The platform fields the modules read, each with its state on the instance.
  readonly fields: readonly PlannedField[];
  // The pack's update sets from older versions still in progress, oldest first: the install
  // completes them before its first push (ADR-0038, section 6).
  readonly earlierSets: readonly OpenSet[];
  readonly data: {
    readonly source: "demo" | "directory";
    readonly entities: readonly PlannedEntity[];
  };
  // Files an earlier version wrote that this one no longer ships, still in the workspace: named,
  // never deleted; a problem until the user removes them (ADR-0026, M8).
  readonly leftovers: readonly string[];
  // Any problem stops the install before it changes anything.
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
  // The facts the plan was built from: the instance's mirror commit when it was planned.
  readonly basis: { readonly mirrorCommit: string; readonly content: string };
}

function actionOf(check: ComponentCheck): { action: ComponentAction; reason: string } {
  if (check.state === "active") return { action: "none", reason: `active, ${check.version ?? ""}` };
  if (check.state === "too-old") {
    return {
      action: "blocked",
      reason: `${check.version} is older than ${check.minVersion}: upgrade it on the instance`,
    };
  }
  if (check.state === "missing") {
    return {
      action: "blocked",
      reason:
        check.entitlement === "licensed"
          ? "not on the instance: it needs an entitlement this instance lacks"
          : "not on the instance: the platform's installer cannot reach it",
    };
  }
  return check.kind === "plugin"
    ? { action: "activate", reason: "installed, inactive: activated by the install" }
    : {
        action: "blocked",
        reason: "an inactive store application: activate it in Application Manager (spike S-F)",
      };
}

// Each component once, with the modules that need it, in the order modules need them.
export function plannedComponents(report: PreflightReport): PlannedComponent[] {
  const byKey = new Map<string, PlannedComponent>();
  for (const module of report.capabilities) {
    for (const check of module.components) {
      const key = `${check.kind}:${check.id}`;
      const known = byKey.get(key);
      byKey.set(
        key,
        known === undefined
          ? { ...check, modules: [module.id], ...actionOf(check) }
          : { ...known, modules: [...known.modules, module.id] },
      );
    }
  }
  return [...byKey.values()];
}

// The plan's id: its content and the facts it was built from, so any change makes a new plan.
export function installPlanId(plan: Omit<InstallPlan, "planId">): string {
  const material = canonicalJson({
    pack: plan.pack,
    version: plan.version,
    instance: plan.instance.name,
    selection: {
      profile: plan.selection.profile ?? null,
      modules: [...(plan.selection.modules ?? [])],
    },
    modules: plan.modules.map((m) => ({ id: m.id, label: m.label, files: [...m.files] })),
    components: plan.components.map((c) => ({
      key: `${c.kind}:${c.id}`,
      state: c.state,
      version: c.version,
      action: c.action,
    })),
    fields: plan.fields.map((f) => `${f.module} ${f.table}.${f.field} ${f.state}`),
    // Absent when empty, so plans without earlier sets keep the ids they had.
    ...(plan.earlierSets.length === 0 ? {} : { earlierSets: plan.earlierSets.map((s) => s.name) }),
    data: {
      source: plan.data.source,
      entities: plan.data.entities.map((e) => ({ entity: e.entity, rows: e.rows })),
    },
    basis: { mirrorCommit: plan.basis.mirrorCommit, content: plan.basis.content },
  });
  return sha256Hex(material).slice(0, 16);
}

export function blockingProblems(
  components: readonly PlannedComponent[],
  report: PreflightReport,
): string[] {
  return [
    ...report.problems,
    ...components
      .filter((c) => c.action === "blocked")
      .map((c) => `${c.kind} ${c.id} (${c.modules.join(", ")}): ${c.reason}`),
  ];
}

// One step of an install, as the journal and the report record it.
export interface InstallStepRecord {
  readonly step: string;
  readonly outcome: "done" | "skipped" | "stopped";
  readonly detail: string;
  readonly seconds: number;
}

// An install in progress, kept until it finishes so a re-run with the same plan id resumes it.
export interface InstallRecord {
  readonly planId: string;
  readonly startedAt: string;
  readonly steps: readonly InstallStepRecord[];
}
