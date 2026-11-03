import { TableName } from "../../kernel/table-name";
import type { KeysetPager } from "../../sync/application/keyset-pager";
import {
  ActivationStateUnknownError,
  PluginActivationFailedError,
  PluginNotFoundError,
} from "../domain/errors";
import type { ActivationProgress, PluginActivator } from "../ports";
import {
  type ActivationLimits,
  DEFAULT_LIMITS,
  type FollowDependencies,
  follow,
  startOnce,
  type UnknownOutcome,
} from "./follow-progress";

export interface ActivationDependencies extends FollowDependencies {
  readonly pager: KeysetPager;
  readonly activator: PluginActivator;
}

export { type ActivationLimits, DEFAULT_LIMITS } from "./follow-progress";

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
  const unknown: UnknownOutcome = (reason, progressId) =>
    new ActivationStateUnknownError(pluginId, reason, progressId);
  const first = await startOnce(() => deps.activator.activate(pluginId, signal), unknown);
  const final = await follow(deps, first, (id) => deps.activator.progress(id, signal), {
    limits,
    signal,
    report,
    unknown,
  });
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
