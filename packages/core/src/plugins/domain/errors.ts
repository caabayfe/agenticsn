import { SnagenticError } from "../../kernel/errors";

export class PluginNotFoundError extends SnagenticError {
  constructor(instance: string, pluginId: string) {
    super(
      "plugin-not-found",
      "precondition",
      `${instance} has no plugin with id ${pluginId}`,
      `find its id with: snagentic plugins list ${instance} <text>`,
    );
  }
}

export class PluginActivationFailedError extends SnagenticError {
  constructor(pluginId: string, progressId: string, reason: string) {
    super(
      "plugin-activation-failed",
      "remote",
      `activating ${pluginId} failed: ${reason || "no reason given"} (progress ${progressId})`,
      "read the plugin's activation log on the instance before trying again",
    );
  }
}

// A change the instance may or may not be making: never assume either way, never retry. Its
// progress id, when known, lets a later run read the outcome instead of asking again.
export abstract class UnknownOutcomeError extends SnagenticError {
  readonly progressId: string | null;

  protected constructor(code: string, message: string, hint: string, progressId: string | null) {
    super(code, "remote", message, hint);
    this.progressId = progressId;
  }
}

// The instance may or may not be activating the plugin.
export class ActivationStateUnknownError extends UnknownOutcomeError {
  constructor(pluginId: string, reason: string, progressId: string | null) {
    super(
      "activation-state-unknown",
      `the state of ${pluginId}'s activation is unknown: ${reason}`,
      progressId === null
        ? `check on the instance whether ${pluginId} is activating before trying again; it was not retried`
        : `check progress ${progressId} on the instance (sys_execution_tracker) before trying again; it was not retried`,
      progressId,
    );
  }
}

export class ConfirmationRequiredError extends SnagenticError {
  constructor(action: string) {
    super(
      "confirmation-required",
      "usage",
      `${action} changes the instance and cannot be undone`,
      "run it again with --confirm",
    );
  }
}

export class StoreAppNotOfferedError extends SnagenticError {
  constructor(instance: string, scope: string) {
    super(
      "store-app-not-offered",
      "precondition",
      `${instance}'s store does not offer ${scope} for install`,
      `check the scope and the instance's entitlement in Application Manager (snagentic plugins list ${instance} ${scope} shows what is installed)`,
    );
  }
}

export class StoreAppOutdatedError extends SnagenticError {
  constructor(scope: string, installed: string, wanted: string) {
    super(
      "store-app-outdated",
      "precondition",
      `${scope} ${installed} is installed, older than ${wanted}`,
      "upgrade it in Application Manager, where its upgrade notes are shown; snagentic installs, it does not upgrade",
    );
  }
}

export class StoreAppInstallFailedError extends SnagenticError {
  constructor(scope: string, progressId: string, reason: string) {
    super(
      "store-app-install-failed",
      "remote",
      `installing ${scope} failed: ${reason || "no reason given"} (progress ${progressId})`,
      "read the application's install log in Application Manager before trying again",
    );
  }
}

// The instance may or may not be installing the application.
export class StoreAppInstallStateUnknownError extends UnknownOutcomeError {
  constructor(scope: string, reason: string, progressId: string | null) {
    super(
      "store-app-install-state-unknown",
      `the state of ${scope}'s install is unknown: ${reason}`,
      progressId === null
        ? `check in Application Manager whether ${scope} is installing before trying again; it was not retried`
        : `check progress ${progressId} on the instance (sys_execution_tracker) before trying again; it was not retried`,
      progressId,
    );
  }
}

// A change an earlier run lost, still under way on the instance: asking again would start it twice.
export class ComponentChangeRunningError extends UnknownOutcomeError {
  constructor(change: string, status: string, percent: number, progressId: string) {
    super(
      "component-change-running",
      `${change} is still ${status} (${percent}%) on the instance (progress ${progressId})`,
      "run the same command again once it finishes; it was not requested again",
      progressId,
    );
  }
}

// A change an earlier run lost, which the instance says did not finish: the next run asks again.
export class ComponentChangeFailedError extends SnagenticError {
  constructor(change: string, status: string, reason: string, progressId: string) {
    super(
      "component-change-failed",
      "remote",
      `${change} ${status} on the instance: ${reason || "no reason given"} (progress ${progressId})`,
      "read its log on the instance, fix the cause, then run the same command to request it again",
    );
  }
}
