import {
  type ActivationProgress,
  type ActivationStatus,
  InstanceError,
  type PluginActivator,
} from "@snagentic/core";
// The connection the activator talks through (ServiceNowClient).
export interface ApiCaller {
  callApi(
    method: "GET" | "POST",
    path: string,
    what: string,
    signal: AbortSignal,
  ): Promise<unknown>;
}

// sn_cicd answers with numeric states.
const STATUS: Readonly<Record<string, ActivationStatus>> = {
  "0": "pending",
  "1": "running",
  "2": "successful",
  "3": "failed",
  "4": "canceled",
};

interface CicdResult {
  links?: { progress?: { id?: string } };
  status?: string;
  status_message?: string;
  status_detail?: string;
  error?: string;
  percent_complete?: number | string;
}

function progressOf(result: unknown, what: string, knownId?: string): ActivationProgress {
  const answer = (result ?? {}) as CicdResult;
  const progressId = answer.links?.progress?.id ?? knownId ?? "";
  const status = STATUS[String(answer.status ?? "")];
  if (status === undefined || progressId === "") {
    throw new InstanceError(`${what}: the response was not a CI/CD progress record`);
  }
  return {
    progressId,
    status,
    percent: Number(answer.percent_complete ?? 0) || 0,
    message: [answer.status_message, answer.status_detail].filter(Boolean).join(": "),
    error: answer.error ?? "",
  };
}

// ServiceNow's supported CI/CD API: POST /api/sn_cicd/plugin/{id}/activate starts an
// activation, GET /api/sn_cicd/progress/{id} follows it.
export class CicdPluginActivator implements PluginActivator {
  constructor(private readonly client: ApiCaller) {}

  async activate(pluginId: string, signal: AbortSignal): Promise<ActivationProgress> {
    const what = `activating plugin ${pluginId}`;
    const path = `/api/sn_cicd/plugin/${encodeURIComponent(pluginId)}/activate`;
    return progressOf(await this.client.callApi("POST", path, what, signal), what);
  }

  async progress(progressId: string, signal: AbortSignal): Promise<ActivationProgress> {
    const what = `activation progress ${progressId}`;
    const path = `/api/sn_cicd/progress/${encodeURIComponent(progressId)}`;
    return progressOf(await this.client.callApi("GET", path, what, signal), what, progressId);
  }
}
