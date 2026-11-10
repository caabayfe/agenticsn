import type { InstanceKind, LoadSettings } from "../../instance/domain/profile";

export interface LoadLimits {
  // The adaptive controller's ceiling: requests in flight to the instance at once.
  readonly maxConcurrency: number;
  // Request starts per second to the instance, across every run in the process.
  readonly requestsPerSecond: number;
  // Requests one run may send.
  readonly requestBudget: number;
}

// About four times the measured full pull of a developer instance (5,180 requests).
const RUN_BUDGET = 20_000;

const DEVELOPMENT: LoadLimits = {
  maxConcurrency: 4,
  requestsPerSecond: 10,
  requestBudget: RUN_BUDGET,
};

// Test and production share their worker pool with real users.
const SHARED: LoadLimits = { maxConcurrency: 2, requestsPerSecond: 5, requestBudget: RUN_BUDGET };

export function defaultLoadLimits(kind: InstanceKind): LoadLimits {
  return kind === "development" ? DEVELOPMENT : SHARED;
}

const lower = (limit: number, setting: number | undefined) =>
  setting === undefined ? limit : Math.min(limit, setting);

// instance.yaml is committed and agents edit workspaces, so it can only lower a limit. The
// environment belongs to whoever runs the machine or the CI job: it may lower all three and
// raise only the budget, which a large instance legitimately needs more of.
export function effectiveLoadLimits(
  kind: InstanceKind,
  sources: { readonly file?: LoadSettings; readonly environment?: LoadSettings },
): LoadLimits {
  const defaults = defaultLoadLimits(kind);
  const environment = sources.environment ?? {};
  const file = sources.file ?? {};
  const budget = environment.requestBudget ?? defaults.requestBudget;
  return {
    maxConcurrency: lower(
      lower(defaults.maxConcurrency, environment.maxConcurrency),
      file.maxConcurrency,
    ),
    requestsPerSecond: lower(
      lower(defaults.requestsPerSecond, environment.requestsPerSecond),
      file.requestsPerSecond,
    ),
    requestBudget: lower(budget, file.requestBudget),
  };
}
