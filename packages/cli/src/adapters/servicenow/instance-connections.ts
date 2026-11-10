import {
  credentialVariable,
  type DevelopmentProfile,
  effectiveLoadLimits,
  type InstanceProfile,
  type LoadLimits,
  type LoadSettings,
  SnagenticError,
} from "@snagentic/core";
import type { RequestSender } from "./authorization";
import type { SchedulerClock, Transport } from "./http-types";
import { RequestScheduler } from "./request-scheduler";
import { ServiceNowClient } from "./servicenow-client";
import { ServiceNowWriteClient } from "./servicenow-write-client";

class InvalidLoadLimitError extends SnagenticError {
  constructor(variable: string, value: string) {
    super(
      "invalid-load-limit",
      "usage",
      `${variable} is "${value}", not a positive whole number`,
      `set ${variable} to a whole number above 0, or unset it`,
    );
  }
}

const VARIABLES = {
  maxConcurrency: "MAX_CONCURRENCY",
  requestsPerSecond: "REQUESTS_PER_SECOND",
  requestBudget: "REQUEST_BUDGET",
} as const;

// SNAGENTIC_<NAME>_MAX_CONCURRENCY and the like, named after the credential variables
// (ADR-0020, ADR-0053).
function variablePrefix(profile: InstanceProfile): string {
  return credentialVariable(profile).replace(/_PASSWORD$/, "");
}

export function environmentLoadSettings(
  profile: InstanceProfile,
  environment: Readonly<Record<string, string | undefined>>,
): LoadSettings {
  const prefix = variablePrefix(profile);
  const settings: Record<string, number> = {};
  for (const [setting, suffix] of Object.entries(VARIABLES)) {
    const variable = `${prefix}_${suffix}`;
    const value = environment[variable];
    if (value === undefined || value === "") {
      continue;
    }
    if (!/^\d+$/.test(value) || Number(value) < 1) {
      throw new InvalidLoadLimitError(variable, value);
    }
    settings[setting] = Number(value);
  }
  return settings;
}

export interface InstanceConnectionsSettings {
  readonly transport: Transport;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly version: string;
  readonly clock?: SchedulerClock;
}

interface Pooled {
  readonly limits: string;
  readonly scheduler: RequestScheduler;
}

// One request scheduler per instance and process (ADR-0016 §4, ADR-0053): every connection to
// an instance, from any command or concurrent MCP call, is a run on the same scheduler.
export class InstanceConnections {
  private readonly schedulers = new Map<string, Pooled>();

  constructor(private readonly settings: InstanceConnectionsSettings) {}

  open(profile: InstanceProfile, secret: string): ServiceNowClient {
    return new ServiceNowClient(profile, secret, this.run(profile), this.settings.version);
  }

  // The write client itself refuses a profile that is not development (ADR-0012), before it
  // sends anything.
  openForWrite(profile: DevelopmentProfile, secret: string): ServiceNowWriteClient {
    return new ServiceNowWriteClient(profile, secret, this.run(profile), this.settings.version);
  }

  private run(profile: InstanceProfile): RequestSender {
    const limits = effectiveLoadLimits(profile.kind, {
      file: profile.load ?? {},
      environment: environmentLoadSettings(profile, this.settings.environment),
    });
    return this.scheduler(profile.url, limits).run({
      budget: limits.requestBudget,
      budgetVariable: `${variablePrefix(profile)}_REQUEST_BUDGET`,
    });
  }

  // One scheduler per instance, keyed by its address only: when its limits change (instance.yaml
  // edited while an MCP server runs), the scheduler takes them, runs already going included, so
  // two schedulers never talk to the instance at once.
  private scheduler(url: string, limits: LoadLimits): RequestScheduler {
    const key = `${limits.maxConcurrency}/${limits.requestsPerSecond}`;
    const pooled = this.schedulers.get(url);
    if (pooled !== undefined) {
      if (pooled.limits !== key) {
        pooled.scheduler.reconfigure(limits);
        this.schedulers.set(url, { limits: key, scheduler: pooled.scheduler });
      }
      return pooled.scheduler;
    }
    const scheduler = new RequestScheduler(this.settings.transport, {
      maxConcurrency: limits.maxConcurrency,
      requestsPerSecond: limits.requestsPerSecond,
      ...(this.settings.clock === undefined ? {} : { clock: this.settings.clock }),
    });
    this.schedulers.set(url, { limits: key, scheduler });
    return scheduler;
  }
}
