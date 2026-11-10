import { AsyncLocalStorage } from "node:async_hooks";
import { InstanceName, withWorkspaceLock } from "@snagentic/core";
import { qualifiedName, type UseCase, type UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

// The locks the current run holds, so the use cases a command is made of (an install's pull,
// push, integrate) run under its lock instead of being refused by it. Carried by the async
// context, never by the process: two MCP calls in one server are still two runs.
const heldByRun = new AsyncLocalStorage<ReadonlySet<string>>();

// Every write use case on an instance holds that instance's workspace lock (REL-03), unless
// its flags say it changes neither the workspace nor the instance.
export function locksWorkspace(useCase: UseCase): boolean {
  return (
    !useCase.flags.readOnly &&
    useCase.flags.locksWorkspace !== false &&
    "instance" in useCase.input.shape
  );
}

export async function underWorkspaceLock<T>(
  useCase: UseCase,
  input: Record<string, unknown>,
  context: UseCaseContext,
  work: () => Promise<T>,
): Promise<T> {
  const instance = input["instance"];
  if (!locksWorkspace(useCase) || typeof instance !== "string") {
    return work();
  }
  const root = await workspaceRoot(context);
  const name = InstanceName.parse(instance);
  const key = JSON.stringify([root, name]);
  const held = heldByRun.getStore() ?? new Set<string>();
  if (held.has(key)) {
    return work();
  }
  const claim = {
    instance: name,
    command: qualifiedName(useCase),
    started: context.clock().toISOString(),
  };
  return withWorkspaceLock(context.workspaceLock(root, name), claim, () =>
    heldByRun.run(new Set([...held, key]), work),
  );
}
