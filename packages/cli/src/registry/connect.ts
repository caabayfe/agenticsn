import {
  ensureDevelopmentInstance,
  getInstance,
  InstanceName,
  KeysetPager,
  resolveAccess,
  verifyReadOnlyCredential,
} from "@snagentic/core";
import type { UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

async function target(context: UseCaseContext, instance: string) {
  const root = await workspaceRoot(context);
  const name = InstanceName.parse(instance);
  const profile = await getInstance(root, name, context.profiles);
  return { root, name, profile };
}

// The workspace, the instance's profile and an open connection to it. A test or production
// connection is used only once its credential has proved to be read-only (ADR-0012).
export async function connect(context: UseCaseContext, instance: string, signal: AbortSignal) {
  const { root, name, profile } = await target(context, instance);
  const { secret } = await resolveAccess(profile, context.credentials);
  const reader = context.connections.open(profile, secret);
  await verifyReadOnlyCredential(profile, reader, signal);
  return { root, name, profile, reader, pager: new KeysetPager(reader) };
}

// The same with the write ports, for a use case that changes the instance: only a development
// instance has them (ADR-0012 layer 3).
export async function connectForWrite(
  context: UseCaseContext,
  instance: string,
  signal: AbortSignal,
) {
  const { root, name, profile } = await target(context, instance);
  ensureDevelopmentInstance(profile, `changing ${name}`);
  const { secret } = await resolveAccess(profile, context.credentials);
  const reader = context.connections.openForWrite(profile, secret);
  await verifyReadOnlyCredential(profile, reader, signal);
  return { root, name, profile, reader, pager: new KeysetPager(reader) };
}
