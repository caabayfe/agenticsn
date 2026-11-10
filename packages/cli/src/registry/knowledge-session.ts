import {
  InstanceName,
  InvalidInputError,
  type KnowledgeDependencies,
  listInstances,
  refreshIndex,
} from "@snagentic/core";
import type { ProgressEvent, UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

// The instance a knowledge tool is about: the one named, or the workspace's only one.
export async function instanceFor(root: string, context: UseCaseContext, name: string | undefined) {
  if (name !== undefined) {
    return InstanceName.parse(name);
  }
  const profiles = await listInstances(root, context.profiles);
  const [only, ...others] = profiles;
  if (only === undefined || others.length > 0) {
    const names = profiles.map((profile) => profile.name).join(", ") || "none yet";
    throw new InvalidInputError(`name the instance (this workspace has: ${names})`);
  }
  return only.name;
}

// Opens the instance's knowledge index, brought up to date with the workspace's files. The
// caller closes `store` when done (`withKnowledge` does): a long-running MCP server opens one
// per call, and an open SQLite file can't be removed on Windows.
export async function knowledgeSession(
  context: UseCaseContext,
  name: string | undefined,
  progress: (event: ProgressEvent) => void,
): Promise<KnowledgeDependencies & { readonly instance: string }> {
  const root = await workspaceRoot(context);
  const instance = await instanceFor(root, context, name);
  const { store, files } = context.knowledge(root, instance);
  try {
    progress({ message: "updating the knowledge index" });
    await refreshIndex(store, files);
    const state = context.syncState(root, instance);
    return {
      instance,
      store,
      files,
      catalog: await state.readCatalog(),
      asOf: (await state.readState())?.watermark ?? null,
      now: context.clock,
    };
  } catch (error) {
    store.close();
    throw error;
  }
}

// Runs `use` on an open knowledge session and closes it afterwards, whatever happens.
export async function withKnowledge<T>(
  context: UseCaseContext,
  name: string | undefined,
  progress: (event: ProgressEvent) => void,
  use: (deps: KnowledgeDependencies & { readonly instance: string }) => Promise<T>,
): Promise<T> {
  const deps = await knowledgeSession(context, name, progress);
  try {
    return await use(deps);
  } finally {
    deps.store.close();
  }
}
