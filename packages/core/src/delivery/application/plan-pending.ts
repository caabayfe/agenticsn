import { unitDigest } from "../../authoring/domain/digest";
import type { BuiltUnit } from "../../authoring/domain/unit";
import type { InstanceReader } from "../../connection/ports";
import { TableName } from "../../kernel/table-name";
import { isKeyedDeletion } from "../domain/pending-delivery";
import type { UnitProblem } from "../domain/unit-plan";
import type { PushJournal, PushJournalStore } from "../ports";

interface PendingPlanDependencies {
  readonly journal?: PushJournalStore;
  readonly url?: string;
  readonly reader: InstanceReader;
  readonly signal: AbortSignal;
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
) {
  return { instance, url: deps.url ?? "", label, pending: journal?.pending ?? [] };
}

export async function pendingJournal(
  deps: PendingPlanDependencies,
  instance: string,
  label: string,
): Promise<{ journal: PushJournal | null; problems: UnitProblem[] }> {
  const journal = (await deps.journal?.read()) ?? null;
  const unsafe = (reason: string): UnitProblem => ({
    project: "source",
    updateName: "",
    kind: "unsafe",
    reason,
  });
  if (journal === null) return { journal, problems: [] };
  if (journal.pending === undefined && journal.steps.length > 0)
    return {
      journal,
      problems: [
        unsafe(
          "legacy interrupted push has no per-unit delivery evidence: inspect its update sets and reconcile before removing the journal",
        ),
      ],
    };
  if ((journal.pending ?? []).length === 0) return { journal, problems: [] };
  if (journal.instance !== instance || journal.url !== deps.url || journal.label !== label)
    return {
      journal,
      problems: [
        unsafe(
          "unfinished delivery belongs to a different instance URL or batch label: use the original target before reconciling",
        ),
      ],
    };
  const problems: UnitProblem[] = [];
  for (const id of new Set(journal.pending?.map((entry) => entry.updateSet))) {
    const sets = await deps.reader.query(
      {
        table: TableName.parse("sys_update_set"),
        query: `sys_id=${id}`,
        fields: ["state"],
        limit: 1,
      },
      deps.signal,
    );
    if (sets[0]?.["state"] !== "in progress")
      problems.push(
        unsafe(
          `unfinished delivery's update set ${id} is missing or closed: reconcile it before continuing`,
        ),
      );
  }
  return { journal, problems };
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
            reason:
              "unfinished delivery no longer has its source definition: reconcile the journal and target update set first",
          },
        ];
  });
}
