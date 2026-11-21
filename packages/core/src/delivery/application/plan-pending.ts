import type { BuiltUnit } from "../../authoring/index";
import {
  isKeyedDeletion,
  NO_PENDING_EXIT,
  RECOVERY_GUIDE,
  unitDigest,
} from "../../authoring/index";
import type { InstanceReader } from "../../connection/index";
import { InvalidInputError } from "../../kernel/errors";
import { TableName } from "../../kernel/table-name";
import { inBatch } from "../domain/batch";
import type { UnitProblem } from "../domain/unit-plan";
import type { PushJournal, PushJournalStore } from "../ports";

interface PendingPlanDependencies {
  readonly journal?: PushJournalStore;
  readonly url?: string;
  readonly reader: InstanceReader;
  readonly signal: AbortSignal;
  readonly workspace: { readonly branch: () => Promise<string> };
}

interface PendingProject {
  readonly project: { readonly path: string };
  readonly built: ReadonlyMap<string, { readonly unit: BuiltUnit }>;
}

export function deliveryTarget(
  deps: PendingPlanDependencies,
  instance: string,
  label: string,
  journal: PushJournal | null,
  recoverPending = false,
) {
  return {
    instance,
    url: deps.url ?? "",
    label,
    pending: journal?.pending ?? [],
    ...(recoverPending ? { recoverPending: true } : {}),
  };
}

function checkedLabel(label: string): string {
  if (/[\^\r\n[\]]/.test(label))
    throw new InvalidInputError("label must not contain ^ [ ] or line breaks");
  return label;
}

const unsafe = (reason: string): UnitProblem => ({
  project: "source",
  updateName: "",
  kind: "unsafe",
  reason,
});

async function pendingSets(
  deps: PendingPlanDependencies,
  journal: PushJournal,
  label: string,
  recoverPending: boolean,
): Promise<UnitProblem[]> {
  const problems: UnitProblem[] = [];
  for (const id of new Set(journal.pending?.map((entry) => entry.updateSet))) {
    const sets = await deps.reader.query(
      {
        table: TableName.parse("sys_update_set"),
        query: `sys_id=${id}`,
        fields: recoverPending ? ["state", "name"] : ["state"],
        limit: 1,
      },
      deps.signal,
    );
    if (sets[0]?.["state"] !== "in progress")
      problems.push(
        unsafe(
          `unfinished delivery's update set ${id} is missing or closed: if it was closed, set its state back to In progress on the instance and plan again; otherwise ${NO_PENDING_EXIT}`,
        ),
      );
    else if (recoverPending && !inBatch(label, sets[0]?.["name"] ?? ""))
      problems.push(
        unsafe(`unfinished delivery's update set ${id} no longer belongs to the original batch`),
      );
  }
  return problems;
}

const otherTarget = (journal: PushJournal): string =>
  `unfinished delivery belongs to a different instance URL or batch label: finish it first on instance ${journal.instance ?? "(not recorded)"} (${journal.url ?? "URL not recorded"}) with --label ${JSON.stringify(journal.label ?? "")}`;

export async function pendingJournal(
  deps: PendingPlanDependencies,
  instance: string,
  requestedLabel: string | undefined,
  recoverPending = false,
): Promise<{ journal: PushJournal | null; label: string; problems: UnitProblem[] }> {
  const journal = (await deps.journal?.read()) ?? null;
  const label = checkedLabel(
    requestedLabel ??
      (recoverPending ? journal?.label : undefined) ??
      (await deps.workspace.branch()),
  );
  const result = (problems: UnitProblem[]) => ({ journal, label, problems });
  if (recoverPending && (journal?.pending ?? []).length === 0)
    return result([unsafe("there are no pending delivery receipts to recover")]);
  if (journal === null) return result([]);
  if (journal.pending === undefined && journal.steps.length > 0)
    return result([
      unsafe(
        `legacy interrupted push has no per-unit delivery evidence: check on the instance what its update sets hold; ${NO_PENDING_EXIT}`,
      ),
    ]);
  if ((journal.pending ?? []).length === 0) return result([]);
  if (journal.instance !== instance || journal.url !== deps.url || journal.label !== label)
    return result([unsafe(otherTarget(journal))]);
  return result(await pendingSets(deps, journal, label, recoverPending));
}

export function orphanedPending(
  journal: PushJournal | null,
  loads: readonly PendingProject[],
): UnitProblem[] {
  return (journal?.pending ?? []).flatMap((entry) => {
    const load = loads.find((candidate) => candidate.project.path === entry.project);
    const found = [...(load?.built.values() ?? [])].some(
      ({ unit }) =>
        unit.updateName === entry.updateName ||
        (entry.operation === "delete" &&
          isKeyedDeletion(unit) &&
          entry.digest === unitDigest(unit)),
    );
    return found
      ? []
      : [
          {
            project: entry.project,
            updateName: entry.updateName,
            kind: "unsafe" as const,
            reason: `unfinished delivery no longer has its source definition: restore the definition that was pushed (git) and plan again (${RECOVERY_GUIDE})`,
          },
        ];
  });
}
