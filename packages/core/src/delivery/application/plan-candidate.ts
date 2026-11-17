import type { BuiltUnit, InstanceCopy, LedgerEntry, SourceProject } from "../../authoring/index";
import { ledgerEntryOf, pendingDecision, pendingFor, planUnit } from "../../authoring/index";
import type { InstanceReader } from "../../connection/index";
import { type PlannedUnit, plannedOrProblem, type UnitProblem } from "../domain/unit-plan";
import type { CaptureDecoder, PendingDelivery } from "../ports";
import type { DraftSchemaCache } from "./draft-flow-graph";
import { reconcilePending, recoveryDecision } from "./reconcile-pending";

const COMPILED = new Set(["sys_hub_flow", "sys_hub_action_type_definition"]);

async function inWritableDomain(
  outcome: PlannedUnit | UnitProblem | null,
  unit: BuiltUnit,
  copy: InstanceCopy | null,
  project: string,
  userDomain: () => Promise<string>,
): Promise<PlannedUnit | UnitProblem | null> {
  const domain = copy?.head["sys_domain"] ?? "global";
  if (
    outcome !== null &&
    "operation" in outcome &&
    outcome.operation === "load" &&
    COMPILED.has(unit.head.table) &&
    domain !== (await userDomain())
  ) {
    return {
      project,
      updateName: unit.updateName,
      kind: "unsafe",
      reason: `it is in domain ${domain}, which the signed-in user is not in: the instance would refuse to publish it`,
    };
  }
  return outcome;
}

export async function planCandidate(
  unit: BuiltUnit,
  context: {
    readonly project: SourceProject;
    readonly entries: ReadonlyMap<string, LedgerEntry>;
    readonly digest: string;
    readonly copy: InstanceCopy | null;
    readonly pending: readonly PendingDelivery[];
    readonly removes: string | null;
    readonly userDomain: () => Promise<string>;
    readonly reader: InstanceReader;
    readonly decodeCapture: CaptureDecoder | undefined;
    readonly signal: AbortSignal;
    readonly recoverPending?: boolean;
    readonly draftSchemas?: DraftSchemaCache;
  },
): Promise<PlannedUnit | UnitProblem | null> {
  const { project, copy, digest, entries, pending } = context;
  const entry = ledgerEntryOf(unit, copy, entries);
  const receipt = pendingFor(pending, unit, digest);
  const unfinished =
    receipt === undefined || receipt.digest !== digest || context.recoverPending
      ? receipt
      : await reconcilePending(
          context.reader,
          unit,
          receipt,
          copy,
          context.decodeCapture,
          context.signal,
          {
            allowDraftLoad: true,
            draftSchemas: context.draftSchemas,
          },
        );
  const decision =
    context.recoverPending && receipt !== undefined
      ? await recoveryDecision(
          context.reader,
          unit,
          receipt,
          copy,
          context.decodeCapture,
          context.signal,
        )
      : unfinished === undefined
        ? planUnit(unit, digest, copy, entry)
        : pendingDecision(unit, digest, copy, unfinished, entry);
  const outcome = plannedOrProblem(decision, unit, {
    project: project.path,
    scope: project.scope,
    scopeId: project.scopeId,
    digest,
    ledger: entry?.instance ?? null,
    version: copy?.version ?? null,
    removes: context.removes ?? unfinished?.removes ?? null,
  });
  return inWritableDomain(outcome, unit, copy, project.path, context.userDomain);
}
