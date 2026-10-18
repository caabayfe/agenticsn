// Public API of the accelerators context (ADR-0026).

export { type AddQuery, type AddResult, addPack } from "./application/add-pack";
export {
  checkPack,
  listPacks,
  manifestOf,
  type PackCheck,
  type PackQuery,
  type PackSummary,
} from "./application/check-pack";
export { type EntityLoad, type LoadResult, loadData } from "./application/load-data";
export { packFindings } from "./application/pack-gate";
export { type DataQuery, type DataSource, validateData } from "./application/validate-data";
export { dataOrder, type Selection, selectCapabilities } from "./domain/capability-graph";
export {
  DataSourceRequiredError,
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
  Component,
  DataColumn,
  DataEntity,
  Manifest,
} from "./domain/manifest-types";
export {
  type Adoption,
  type Materialized,
  type MaterializedFile,
  type MaterializeInput,
  materialize,
} from "./domain/materialize";
export {
  demoPath,
  isPackOnly,
  moduleOf,
  PACK_MANIFEST,
  packDocument,
  workspacePathOf,
} from "./domain/pack-layout";
export {
  type CapabilityReport,
  type CapabilityState,
  type ComponentCheck,
  type ComponentState,
  type InstalledComponent,
  olderThan,
  type PreflightReport,
  preflight,
} from "./domain/preflight";
export {
  type EntityReport,
  stagingRow,
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
