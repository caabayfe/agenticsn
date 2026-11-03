import type { Row } from "../kernel/row";

// The operational inventory as the last pull mirrored it, read without calling the instance.
export interface InventoryReader {
  // Rows of instances/<name>/operational/<file>.yaml on the instance's remote branch; null when
  // the inventory was never pulled.
  read(root: string, instance: string, file: string): Promise<readonly Row[] | null>;
}

export type ActivationStatus = "pending" | "running" | "successful" | "failed" | "canceled";

export interface ActivationProgress {
  readonly progressId: string;
  readonly status: ActivationStatus;
  readonly percent: number;
  readonly message: string;
  readonly error: string;
}

// ServiceNow's CI/CD API for plugins (sn_cicd). Starting an activation changes the instance;
// it is never retried.
export interface PluginActivator {
  activate(pluginId: string, signal: AbortSignal): Promise<ActivationProgress>;
  progress(progressId: string, signal: AbortSignal): Promise<ActivationProgress>;
}

// ServiceNow's CI/CD API for store applications (sn_cicd/app_repo, spec 011, I3). Starting an
// install changes the instance; it is never retried, and asks for the application's demo data only
// when told to (ADR-0048).
export interface StoreAppInstaller {
  install(
    scope: string,
    version: string,
    demoData: boolean,
    signal: AbortSignal,
  ): Promise<ActivationProgress>;
  progress(progressId: string, signal: AbortSignal): Promise<ActivationProgress>;
}
