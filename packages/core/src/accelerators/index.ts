// Public API of the accelerators context (ADR-0026).

export { type AddQuery, type AddResult, addPack } from "./application/add-pack";
export {
  checkPack,
  listPacks,
  type PackCheck,
  type PackQuery,
  type PackSummary,
} from "./application/check-pack";
export { packFindings } from "./application/pack-gate";
export { type DataQuery, validateData } from "./application/validate-data";
export { dataOrder, selectCapabilities } from "./domain/capability-graph";
export {
  InvalidPackError,
  PackNotAddableError,
  PackNotFoundError,
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
  type MaterializedFile,
  type MaterializeInput,
  materialize,
  type PatchTarget,
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
export type { DataTemplates, PackSource, PackWorkspace } from "./ports";
