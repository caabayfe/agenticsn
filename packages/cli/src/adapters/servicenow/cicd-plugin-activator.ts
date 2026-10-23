import {
  type ActivationProgress,
  type ActivationStatus,
  InstanceError,
  type PluginActivator,
} from "@snagentic/core";
import { z } from "zod";

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

// The fields of a progress record snagentic reads.
const CicdResult = z.object({
  links: z.object({ progress: z.object({ id: z.string().optional() }).optional() }).optional(),
  status: z.union([z.string(), z.number()]).optional(),
  status_message: z.string().optional(),
  status_detail: z.string().optional(),
  error: z.string().optional(),
  percent_complete: z.union([z.number(), z.string()]).optional(),
});

function progressOf(result: unknown, what: string, knownId?: string): ActivationProgress {
  const parsed = CicdResult.safeParse(result ?? {});
  const answer = parsed.success ? parsed.data : {};
  const progressId = answer.links?.progress?.id ?? knownId ?? "";
  const status = STATUS[String(answer.status ?? "")];
  if (!parsed.success || status === undefined || progressId === "") {
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
