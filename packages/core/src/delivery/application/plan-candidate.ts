import type { LedgerEntry } from "../../authoring/domain/ledger";
import { planUnit } from "../../authoring/domain/plan-unit";
import { ledgerEntryOf } from "../../authoring/domain/renamed-units";
import type { BuiltUnit, InstanceCopy } from "../../authoring/domain/unit";
import type { SourceProject } from "../../authoring/ports";
import type { InstanceReader } from "../../connection/ports";
import { pendingDecision, pendingFor } from "../domain/pending-delivery";
import { type PlannedUnit, plannedOrProblem, type UnitProblem } from "../domain/unit-plan";
import type { CaptureDecoder, PendingDelivery } from "../ports";
import { reconcilePending } from "./reconcile-pending";

const COMPILED = new Set(["sys_hub_flow", "sys_hub_action_type_definition"]);

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
  },
): Promise<PlannedUnit | UnitProblem | null> {
  const { project, copy, digest, entries, pending } = context;
  const entry = ledgerEntryOf(unit, copy, entries);
  const receipt = pendingFor(pending, unit, digest);
  const unfinished =
    receipt === undefined || receipt.digest !== digest
      ? receipt
      : await reconcilePending(
          context.reader,
          unit,
          receipt,
          copy,
          context.decodeCapture,
          context.signal,
        );
  const decision =
    unfinished === undefined
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
  const domain = copy?.head["sys_domain"] ?? "global";
  if (
    outcome !== null &&
    "operation" in outcome &&
    outcome.operation === "load" &&
    COMPILED.has(unit.head.table) &&
    domain !== (await context.userDomain())
  ) {
    return {
      project: project.path,
      updateName: unit.updateName,
      kind: "unsafe",
      reason: `it is in domain ${domain}, which the signed-in user is not in: the instance would refuse to publish it`,
    };
  }
  return outcome;
}
