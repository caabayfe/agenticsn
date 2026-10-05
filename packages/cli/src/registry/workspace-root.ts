import { resolve } from "node:path";
import { locateWorkspace } from "@snagentic/core";
import type { UseCaseContext } from "./use-case";

// The workspace a command works in: --workspace / SNAGENTIC_WORKSPACE, else found from cwd.
export async function workspaceRoot(context: UseCaseContext): Promise<string> {
  const { cwd, workspaceOverride } = context.host;
  const start = workspaceOverride === undefined ? cwd : resolve(cwd, workspaceOverride);
  return (await locateWorkspace(start, context.workspaces)).root;
}
