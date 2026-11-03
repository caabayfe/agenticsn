import type { ActivationProgress, StoreAppInstaller } from "@snagentic/core";
import { type ApiCaller, progressOf } from "./cicd-plugin-activator";

// ServiceNow's supported CI/CD API for store applications (spike S-F, spec 011): POST
// /api/sn_cicd/app_repo/install starts an install, GET /api/sn_cicd/progress/{id} follows it. Demo
// data is asked for only when the caller says so (ADR-0048).
export class CicdAppInstaller implements StoreAppInstaller {
  constructor(private readonly client: ApiCaller) {}

  async install(
    scope: string,
    version: string,
    demoData: boolean,
    signal: AbortSignal,
  ): Promise<ActivationProgress> {
    const what = `installing store application ${scope} ${version}`;
    const query = new URLSearchParams({ scope, version, load_demo_data: String(demoData) });
    const path = `/api/sn_cicd/app_repo/install?${query.toString()}`;
    return progressOf(await this.client.callApi("POST", path, what, signal), what);
  }

  async progress(progressId: string, signal: AbortSignal): Promise<ActivationProgress> {
    const what = `install progress ${progressId}`;
    const path = `/api/sn_cicd/progress/${encodeURIComponent(progressId)}`;
    return progressOf(await this.client.callApi("GET", path, what, signal), what, progressId);
  }
}
