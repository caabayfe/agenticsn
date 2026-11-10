import { AsyncLocalStorage } from "node:async_hooks";
import { InstanceName, WorkspaceNotFoundError, withWorkspaceLock } from "@snagentic/core";
import { type LockScope, qualifiedName, type UseCase, type UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

// The locks the current run holds, so the use cases a command is made of (an install's pull,
// push, integrate) run under its lock instead of being refused by it. Carried by the async
// context, never by the process: two MCP calls in one server are still two runs.
const heldByRun = new AsyncLocalStorage<ReadonlySet<string>>();

// What a use case locks (REL-03): null only for a read-only one. Every other use case holds a
// lock unless it declares it has nothing to lock; the registry test pins each one's scope.
export function lockScope(useCase: UseCase): LockScope | null {
  if (useCase.flags.readOnly) {
    return null;
  }
  if (useCase.flags.lock !== undefined) {
    return useCase.flags.lock;
  }
  return "instance" in useCase.input.shape ? { instance: "instance" } : "workspace";
}

interface Target {
  readonly root: string;
  // Null: the workspace's own lock.
  readonly instance: InstanceName | null;
}

// Outside a workspace there is nothing a workspace command could interleave with (upgrade
// replaces only the binary there), so it runs unlocked; the handler reports a missing workspace.
async function workspaceTarget(context: UseCaseContext): Promise<Target | null> {
  try {
    return { root: await workspaceRoot(context), instance: null };
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) return null;
    throw error;
  }
}

// An instance command whose instance input is left out (optional) writes the workspace only.
async function targetOf(
  scope: LockScope | null,
  input: Record<string, unknown>,
  context: UseCaseContext,
): Promise<Target | null> {
  if (scope === null || scope === "none") {
    return null;
  }
  const instance = scope === "workspace" ? undefined : input[scope.instance];
  if (typeof instance !== "string") {
    return workspaceTarget(context);
  }
  return { root: await workspaceRoot(context), instance: InstanceName.parse(instance) };
}

export async function underWorkspaceLock<T>(
  useCase: UseCase,
  input: Record<string, unknown>,
  context: UseCaseContext,
  work: () => Promise<T>,
): Promise<T> {
  const held = heldByRun.getStore() ?? new Set<string>();
  const target = await targetOf(lockScope(useCase), input, context);
  // A workspace step of a command that already holds a lock (an install's fluent-keys) runs
  // under it: refusing it halfway because of an unrelated docs build would leave the install
  // half done.
  if (target === null || (target.instance === null && held.size > 0)) {
    return work();
  }
  const key = JSON.stringify([target.root, target.instance]);
  if (held.has(key)) {
    return work();
  }
  const claim = {
    instance: target.instance,
    command: qualifiedName(useCase),
    started: context.clock().toISOString(),
  };
  return withWorkspaceLock(context.workspaceLock(target.root, target.instance), claim, () =>
    heldByRun.run(new Set([...held, key]), work),
  );
}
