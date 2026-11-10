import { resolve } from "node:path";
import { applyRepositoryTuning, locateWorkspace } from "@snagentic/core";
import type { RunControl, UseCaseContext } from "./use-case";

// The workspace a command works in: --workspace / SNAGENTIC_WORKSPACE, else found from cwd.
export async function workspaceRoot(context: UseCaseContext): Promise<string> {
  const { cwd, workspaceOverride } = context.host;
  const start = workspaceOverride === undefined ? cwd : resolve(cwd, workspaceOverride);
  return (await locateWorkspace(start, context.workspaces)).root;
}

// Run by the commands that write a workspace's mirror (pull, integrate): the first commands a
// teammate's clone or a CI runner runs, so they set the large-repository git settings that only
// init sets otherwise (spec 014, PERF2-04). Repository config only, unset keys only.
export async function tuneClone(
  context: UseCaseContext,
  root: string,
  run: Pick<RunControl, "progress">,
): Promise<void> {
  const tuned = await applyRepositoryTuning(context.workspaces, root);
  if (tuned.length > 0) {
    run.progress({ message: `tuned this clone's git for a large repository: ${tuned.join(", ")}` });
  }
}
