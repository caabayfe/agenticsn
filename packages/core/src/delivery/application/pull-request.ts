import { baseOfFile } from "../../knowledge/index";
import { pullRequestBody } from "../domain/batch";
import type { PlannedWrite } from "../domain/change";
import {
  PullRequestFromDefaultBranchError,
  PullRequestUnavailableError,
  UncommittedPlannedChangesError,
} from "../domain/errors";
import type { DeliveryWorkspace, PullRequests } from "../ports";

export type PullRequestOutcome =
  | { readonly status: "given" | "found" | "created"; readonly url: string }
  | { readonly status: "none" }
  | { readonly status: "unavailable"; readonly reason: string };

export interface PullRequestDependencies {
  readonly workspace: DeliveryWorkspace;
  readonly pullRequests: PullRequests;
  // The instance's base URL, linked from a draft pull request.
  readonly url: string;
  readonly signal: AbortSignal;
}

export interface PullRequestRequest {
  readonly label: string;
  readonly writes: readonly PlannedWrite[];
  readonly pr?: string;
  readonly draftPr?: boolean;
}

// A pull request shows commits: opening one while a planned record has uncommitted changes
// would show something other than what is pushed.
async function refuseUncommitted(workspace: DeliveryWorkspace, writes: readonly PlannedWrite[]) {
  const planned = new Set(writes.map((write) => baseOfFile(write.path)));
  const uncommitted = (await workspace.uncommittedFiles()).filter((path) =>
    planned.has(baseOfFile(path)),
  );
  if (uncommitted.length > 0) {
    throw new UncommittedPlannedChangesError(uncommitted);
  }
}

async function openDraft(
  deps: PullRequestDependencies,
  branch: string,
  request: PullRequestRequest,
): Promise<string> {
  if ((await deps.pullRequests.defaultBranch(deps.signal)) === branch) {
    throw new PullRequestFromDefaultBranchError(branch);
  }
  await refuseUncommitted(deps.workspace, request.writes);
  await deps.workspace.publishBranch(branch);
  return deps.pullRequests.openDraft(
    { branch, title: branch, body: pullRequestBody(request.label, deps.url) },
    deps.signal,
  );
}

// The branch's pull request to link from its batch (ADR-0022), opened as a draft when asked.
// Runs before any instance write, so a refusal leaves the instance untouched.
export async function pullRequestFor(
  deps: PullRequestDependencies,
  request: PullRequestRequest,
): Promise<PullRequestOutcome> {
  if (request.pr !== undefined) {
    return { status: "given", url: request.pr };
  }
  const branch = await deps.workspace.branch();
  const lookup = await deps.pullRequests.find(branch, deps.signal);
  if (lookup.kind === "found") {
    return { status: "found", url: lookup.url };
  }
  if (request.draftPr !== true) {
    return lookup.kind === "none"
      ? { status: "none" }
      : { status: "unavailable", reason: lookup.reason };
  }
  if (lookup.kind === "unavailable") {
    throw new PullRequestUnavailableError(lookup.reason);
  }
  return { status: "created", url: await openDraft(deps, branch, request) };
}
