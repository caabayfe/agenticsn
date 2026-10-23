// Public API of the accelerators context (ADR-0026).

export { type AddQuery, type AddResult, addPack } from "./application/add-pack";
export { checkFields } from "./application/check-fields";
export {
  checkPack,
  listPacks,
  manifestOf,
  type PackCheck,
  type PackQuery,
  type PackSummary,
} from "./application/check-pack";
export { ensureLayouts, readLayouts } from "./application/ensure-layouts";
export { type EntityLoad, type LoadResult, loadData } from "./application/load-data";
export { mirrorSchema } from "./application/mirror-schema";
export { packFindings } from "./application/pack-gate";
export {
  type InstallPlanDependencies,
  type InstallQuery,
  planInstall,
} from "./application/plan-install";
export {
  type InstallResult,
  type InstallRunDependencies,
  installPack,
} from "./application/run-install";
export { type DataQuery, type DataSource, validateData } from "./application/validate-data";
export { dataOrder, type Selection, selectCapabilities } from "./domain/capability-graph";
export {
  deliveredDetail,
  earlierSets,
  type OpenSet,
  type PackNaming,
  recordedSets,
} from "./domain/earlier-sets";
export {
  type EnsureContainer,
  type EnsureFact,
  ensureContainerSource,
  ensureEntryId,
  ensureFactsOf,
  ensureSource,
  type FactStatus,
  factStatus,
  type ListState,
} from "./domain/ensure";
export {
  DataSourceRequiredError,
  InstallBlockedError,
  InstallLockedError,
  InstallPlanChangedError,
  InvalidPackError,
  LoadConfirmationRequiredError,
  PackNotAddableError,
  PackNotFoundError,
  TemplatesInvalidError,
  TrackedDataError,
} from "./domain/errors";
export { installPlanDocument, installReportDocument } from "./domain/install-document";
export {
  type ComponentAction,
  type InstallPlan,
  type InstallRecord,
  type InstallStepRecord,
  installPlanId,
  type PlannedComponent,
  type PlannedEntity,
  type PlannedField,
  type PlannedModule,
  plannedComponents,
} from "./domain/install-plan";
export { type ManifestOutcome, parseManifest } from "./domain/manifest";
export type {
  Capability,
  Component,
  DataColumn,
  DataEntity,
  Manifest,
  RequiredField,
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
  type FieldCheck,
  type FieldState,
  fieldIssues,
  requiredFields,
} from "./domain/required-fields";
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
  InstallJournal,
  InstallSteps,
  PackSource,
  PackWorkspace,
  SchemaReader,
} from "./ports";
