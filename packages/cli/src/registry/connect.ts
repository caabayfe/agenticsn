import {
  getInstance,
  InstanceName,
  KeysetPager,
  resolveAccess,
  verifyReadOnlyCredential,
} from "@snagentic/core";
import type { UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

// The workspace, the instance's profile and an open connection to it. A test or production
// connection is used only once its credential has proved to be read-only (ADR-0012).
// `elevatedSessions` exists only when a person opted the instance into elevated writes
// (ADR-0024); opening one is what signs in, so building it costs nothing.
export async function connect(context: UseCaseContext, instance: string, signal: AbortSignal) {
  const root = await workspaceRoot(context);
  const name = InstanceName.parse(instance);
  const profile = await getInstance(root, name, context.profiles);
  const { secret, elevation } = await resolveAccess(profile, context.credentials);
  const reader = context.connections.open(profile, secret);
  await verifyReadOnlyCredential(profile, reader, signal);
  const elevatedSessions = elevation ? context.elevatedSessions(profile, secret) : null;
  return { root, name, profile, reader, pager: new KeysetPager(reader), elevatedSessions };
}
