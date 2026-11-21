import {
  assertLiveQueriesAllowed,
  getInstance,
  InstanceName,
  type LiveQueryAccess,
} from "@snagentic/core";
import { connect } from "./connect";
import type { UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

// What a `query` command runs with. An instance whose profile leaves live queries off is
// refused here, before a connection is opened (spec 016, D4).
export async function liveQueryAccess(
  context: UseCaseContext,
  instance: string,
  signal: AbortSignal,
): Promise<LiveQueryAccess> {
  const root = await workspaceRoot(context);
  const name = InstanceName.parse(instance);
  assertLiveQueriesAllowed(await getInstance(root, name, context.profiles));
  const { profile, reader } = await connect(context, instance, signal);
  return { profile, reader, log: context.liveQueryLog(root, name), clock: context.clock };
}
