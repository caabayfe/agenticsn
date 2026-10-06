import { getInstance, InstanceName, KeysetPager, resolveSecret } from "@snagentic/core";
import type { UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

// The workspace, the instance's profile and an open connection to it.
export async function connect(context: UseCaseContext, instance: string) {
  const root = await workspaceRoot(context);
  const name = InstanceName.parse(instance);
  const profile = await getInstance(root, name, context.profiles);
  const reader = context.connections.open(
    profile,
    await resolveSecret(profile, context.credentials),
  );
  return { root, name, profile, reader, pager: new KeysetPager(reader) };
}
