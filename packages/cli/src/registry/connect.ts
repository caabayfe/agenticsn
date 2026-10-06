import {
  getInstance,
  InstanceName,
  KeysetPager,
  resolveSecret,
  verifyReadOnlyCredential,
} from "@snagentic/core";
import type { UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

// The workspace, the instance's profile and an open connection to it. A test or production
// connection is used only once its credential has proved to be read-only (ADR-0012).
export async function connect(context: UseCaseContext, instance: string, signal: AbortSignal) {
  const root = await workspaceRoot(context);
  const name = InstanceName.parse(instance);
  const profile = await getInstance(root, name, context.profiles);
  const reader = context.connections.open(
    profile,
    await resolveSecret(profile, context.credentials),
  );
  await verifyReadOnlyCredential(profile, reader, signal);
  return { root, name, profile, reader, pager: new KeysetPager(reader) };
}
