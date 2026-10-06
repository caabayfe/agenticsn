// Public API of the plugins context.
export {
  type ActivationDependencies,
  type ActivationLimits,
  type ActivationOutcome,
  activatePlugin,
  DEFAULT_LIMITS,
} from "./application/activate-plugin";
export {
  listPlugins,
  type Plugin,
  type PluginFilter,
  type PluginInventory,
  type StoreApp,
} from "./application/list-plugins";
export {
  ActivationStateUnknownError,
  ConfirmationRequiredError,
  PluginActivationFailedError,
  PluginNotFoundError,
} from "./domain/errors";
export type {
  ActivationProgress,
  ActivationStatus,
  InventoryReader,
  PluginActivator,
} from "./ports";
