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

// The instance may or may not be activating the plugin: never assume either way, never retry.
export class ActivationStateUnknownError extends SnagenticError {
  constructor(pluginId: string, reason: string, progressId: string | null) {
    super(
      "activation-state-unknown",
      "remote",
      `the state of ${pluginId}'s activation is unknown: ${reason}`,
      progressId === null
        ? `check on the instance whether ${pluginId} is activating before trying again; it was not retried`
        : `check progress ${progressId} on the instance (sys_execution_tracker) before trying again; it was not retried`,
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
