// Public API of the accelerators context (ADR-0026).

export { type AddQuery, type AddResult, addPack } from "./application/add-pack";
export {
  checkPack,
  listPacks,
  type PackCheck,
  type PackQuery,
  type PackSummary,
} from "./application/check-pack";
export { type EntityLoad, type LoadResult, loadData } from "./application/load-data";
export { packFindings } from "./application/pack-gate";
export { type DataQuery, validateData } from "./application/validate-data";
export { dataOrder, selectCapabilities } from "./domain/capability-graph";
export {
  InvalidPackError,
  LoadConfirmationRequiredError,
  PackNotAddableError,
  PackNotFoundError,
  TemplatesInvalidError,
  TrackedDataError,
} from "./domain/errors";
export { type ManifestOutcome, parseManifest } from "./domain/manifest";
export type {
  Capability,
  DataColumn,
  DataEntity,
  Manifest,
  PluginRequirement,
} from "./domain/manifest-types";
export {
  type Adoption,
  type Materialized,
  type MaterializedFile,
  type MaterializeInput,
  materialize,
} from "./domain/materialize";
export {
  type CapabilityReport,
  type CapabilityState,
  type InstalledPlugin,
  olderThan,
  type PluginCheck,
  type PluginState,
  type PreflightReport,
  preflight,
} from "./domain/preflight";
export {
  type EntityReport,
  type Template,
  type TemplateReport,
  validateTemplates,
} from "./domain/templates";
export { type Carried, carried, type PreviousAdd } from "./domain/upgrade";
export type {
  DataTemplates,
  ImportSetWriter,
  ImportStatus,
  PackSource,
  PackWorkspace,
} from "./ports";
