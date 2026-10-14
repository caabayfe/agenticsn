// Public API of the accelerators context (ADR-0026).

export {
  checkPack,
  listPacks,
  type PackCheck,
  type PackQuery,
  type PackSummary,
} from "./application/check-pack";
export { dataOrder, selectCapabilities } from "./domain/capability-graph";
export { InvalidPackError, PackNotFoundError } from "./domain/errors";
export { type ManifestOutcome, parseManifest } from "./domain/manifest";
export type { Capability, DataEntity, Manifest, PluginRequirement } from "./domain/manifest-types";
export {
  type MaterializedFile,
  type MaterializeInput,
  type MirroredRecord,
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
export type { PackSource } from "./ports";
