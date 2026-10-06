import { SnagenticError } from "../../kernel/errors";
import { TableName } from "../../kernel/table-name";
import type { KeysetPager } from "../../sync/application/keyset-pager";
import {
  ActivationStateUnknownError,
  PluginActivationFailedError,
  PluginNotFoundError,
} from "../domain/errors";
import type { ActivationProgress, PluginActivator } from "../ports";

export interface ActivationDependencies {
  readonly pager: KeysetPager;
  readonly activator: PluginActivator;
  readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly now: () => Date;
}

export interface ActivationLimits {
  readonly pollMs: number;
  readonly maxWaitMs: number;
}

export const DEFAULT_LIMITS: ActivationLimits = { pollMs: 5_000, maxWaitMs: 45 * 60_000 };

export type ActivationOutcome =
  | { readonly state: "already-active"; readonly name: string }
  | {
      readonly state: "activated";
      readonly name: string;
      readonly progressId: string;
      readonly seconds: number;
    };

// The plugin as the instance sees it now (not the possibly stale inventory).
async function currentPlugin(
  deps: ActivationDependencies,
  instance: string,
  pluginId: string,
  signal: AbortSignal,
) {
  const listing = {
    table: TableName.parse("v_plugin"),
    fields: ["sys_id", "id", "name", "active"],
    kind: "snapshot" as const,
    base: `id=${pluginId}`,
  };
  for await (const row of deps.pager.rows(listing, signal)) {
    if (row["id"] === pluginId) {
      return { name: row["name"] ?? pluginId, active: row["active"] === "active" };
    }
  }
  throw new PluginNotFoundError(instance, pluginId);
}

// A refusal the instance stated (rights, unknown plugin) is a definite answer; anything else
// after the request was sent leaves the outcome unknown.
async function start(
  deps: ActivationDependencies,
  pluginId: string,
  signal: AbortSignal,
): Promise<ActivationProgress> {
  try {
    return await deps.activator.activate(pluginId, signal);
  } catch (error) {
    if (
      error instanceof SnagenticError &&
      (error.category === "not-permitted" || error.category === "usage")
    ) {
      throw error;
    }
    throw new ActivationStateUnknownError(
      pluginId,
      error instanceof Error ? error.message : String(error),
      null,
    );
  }
}

async function poll(
  deps: ActivationDependencies,
  pluginId: string,
  first: ActivationProgress,
  limits: ActivationLimits,
  signal: AbortSignal,
  report: (progress: ActivationProgress) => void,
): Promise<ActivationProgress> {
  const started = deps.now().getTime();
  let current = first;
  while (current.status === "pending" || current.status === "running") {
    report(current);
    if (deps.now().getTime() - started >= limits.maxWaitMs) {
      throw new ActivationStateUnknownError(
        pluginId,
        `still ${current.status} after ${Math.round(limits.maxWaitMs / 60_000)} min`,
        current.progressId,
      );
    }
    await deps.sleep(limits.pollMs, signal);
    try {
      current = await deps.activator.progress(current.progressId, signal);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ActivationStateUnknownError(
        pluginId,
        `its progress could not be read: ${reason}`,
        current.progressId,
      );
    }
  }
  return current;
}

// Activates a plugin through the CI/CD API and follows it to the end (plan 5.2). Never
// retried: an ambiguous failure is reported as unknown, with what to check.
export async function activatePlugin(
  deps: ActivationDependencies,
  instance: string,
  pluginId: string,
  signal: AbortSignal,
  report: (progress: ActivationProgress) => void = () => {},
  limits: ActivationLimits = DEFAULT_LIMITS,
): Promise<ActivationOutcome> {
  const plugin = await currentPlugin(deps, instance, pluginId, signal);
  if (plugin.active) {
    return { state: "already-active", name: plugin.name };
  }
  const started = deps.now().getTime();
  const final = await poll(
    deps,
    pluginId,
    await start(deps, pluginId, signal),
    limits,
    signal,
    report,
  );
  if (final.status !== "successful") {
    throw new PluginActivationFailedError(
      pluginId,
      final.progressId,
      final.error || final.message || final.status,
    );
  }
  const seconds = Math.round((deps.now().getTime() - started) / 1000);
  return { state: "activated", name: plugin.name, progressId: final.progressId, seconds };
}
