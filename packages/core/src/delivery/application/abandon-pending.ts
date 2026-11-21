import { InvalidInputError } from "../../kernel/errors";
import { abandonedLine, abandonedOf, abandonMessage } from "../domain/abandoned-delivery";
import { batchName } from "../domain/batch";
import {
  NoPendingDeliveryError,
  PendingDeliveryPlanError,
  PushConfirmationRequiredError,
} from "../domain/errors";
import type { DeliveryWorkspace, PushJournal, PushJournalStore } from "../ports";
import type { UnitPushResult } from "./push-units";

// Drops an unfinished delivery that recovery cannot finish (ADR-0050, amendment A1). It reads
// the push journal and writes git and the journal: it takes no instance port, so it cannot
// roll anything back, and what the stopped push wrote stays on the instance. That list is
// shown before confirmation and recorded in a commit before the journal is cleared.

export interface AbandonPendingDependencies {
  readonly journal: PushJournalStore;
  readonly workspace: Pick<DeliveryWorkspace, "commitRecord">;
  // The instance's base URL, for links to the update sets.
  readonly url: string;
}

// Push's own query, of which abandoning uses the target, the plan id and the confirmation;
// the delivery options are named only to be refused.
export interface AbandonPendingQuery {
  readonly instance: string;
  readonly planId: string;
  readonly confirm: boolean;
  readonly pr?: string;
  readonly draftPr?: boolean;
  readonly recoverPending?: boolean;
}

const unfinished = (journal: PushJournal | null): journal is PushJournal =>
  journal !== null &&
  (journal.pending === undefined ? journal.steps.length > 0 : journal.pending.length > 0);

function checkedQuery(query: AbandonPendingQuery): void {
  if (query.recoverPending === true || query.pr !== undefined || query.draftPr === true)
    throw new InvalidInputError(
      "--abandon-pending delivers nothing: it takes only --instance, --plan and --confirm",
    );
}

// The switched preferences a stopped push did not restore stay journaled: restoring them is a
// write to the instance, which the next push does.
async function clearPending(store: PushJournalStore, journal: PushJournal): Promise<string[]> {
  if (journal.preferences.length === 0) {
    await store.clear();
    return [];
  }
  await store.write({ ...journal, pending: [], steps: [] });
  return [
    `the stopped push switched ${journal.preferences.length} of your preferences on the instance (current application or update set) and did not restore them: the next push restores them, or set them on the instance`,
  ];
}

export async function abandonPending(
  deps: AbandonPendingDependencies,
  query: AbandonPendingQuery,
): Promise<UnitPushResult> {
  checkedQuery(query);
  const journal = await deps.journal.read();
  if (!unfinished(journal)) throw new NoPendingDeliveryError(query.instance);
  if (journal.planId !== query.planId)
    throw new PendingDeliveryPlanError(query.planId, journal.planId, query.instance);
  const abandoned = abandonedOf(journal, deps.url);
  if (!query.confirm) throw new PushConfirmationRequiredError(abandoned.map(abandonedLine));
  // Recorded first: a commit that fails leaves the journal, and the delivery still pending.
  const commit = await deps.workspace.commitRecord(
    abandonMessage(journal.planId, query.instance, abandoned),
  );
  const warnings = await clearPending(deps.journal, journal);
  return {
    instance: query.instance,
    planId: journal.planId,
    // The stopped push's batch by name: its record is not read, so it has no sys_id or link here.
    batch: {
      name: journal.label === undefined ? "" : batchName(journal.label),
      sysId: "",
      created: false,
      link: "",
    },
    pullRequest: { status: "none" },
    updateSets: [],
    units: [],
    notCaptured: 0,
    notApplied: 0,
    refused: [],
    ledgerCommit: commit,
    warnings,
    abandoned,
    next: [{ tool: "plan_push", args: { instance: query.instance } }],
  };
}
