import {
  InstanceName,
  packFindings,
  SdkUnavailableError,
  type UnitPlanDependencies,
  VERSION,
} from "@snagentic/core";
import type { connect } from "./connect";
import type { UseCaseContext } from "./use-case";

type Connection = Awaited<ReturnType<typeof connect>>;

// What plan and push on built units read (ADR-0031, ADR-0033), wired from the context.
export function unitPlanDependencies(
  context: UseCaseContext,
  connection: Connection,
  signal: AbortSignal,
): UnitPlanDependencies {
  const { root, reader, pager } = connection;
  const instance = InstanceName.parse(connection.name);
  return {
    authoring: context.authoring(root),
    reader,
    workspace: context.delivery(root, instance),
    governance: context.governance(root, instance),
    packGate: (paths) =>
      packFindings(
        { packs: context.packs, inventory: context.inventory },
        { instance: { root, name: instance }, paths, snagentic: VERSION },
      ),
    updateSets: { pager, statistics: reader, now: context.clock },
    now: context.clock,
    signal,
  };
}

// The connection's fluent/load, without which nothing can be pushed.
export function installerOf(connection: Connection) {
  const installer = connection.reader.fluent;
  if (installer === undefined) throw new SdkUnavailableError(connection.name);
  return installer;
}
