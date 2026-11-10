// Public API of @snagentic/core. Other packages import only from here.

export * from "./accelerators/index";
export * from "./advice/index";
export * from "./authoring/index";
export * from "./connection/index";
export * from "./delivery/index";
export * from "./documentation/index";
export { checkAgentPack } from "./environment/application/check-agent-pack";
export { checkMcpConfigs } from "./environment/application/check-mcp-configs";
export { checkRepositoryTuning } from "./environment/application/check-repository-tuning";
export { runDoctor } from "./environment/application/run-doctor";
export { runInstanceChecks } from "./environment/application/run-instance-checks";
export {
  CHECK_STATUSES,
  type Check,
  type CheckStatus,
  type DoctorReport,
  summarizeChecks,
} from "./environment/domain/check";
export {
  networkCheck,
  PROXY_VARIABLES,
  RUNTIME_VARIABLES,
  TRUST_VARIABLES,
} from "./environment/domain/network";
export type { EnvironmentProbe } from "./environment/ports";
export * from "./governance/index";
export * from "./instance/index";
export { canonicalJson, type JsonValue } from "./kernel/canonical-json";
export { canonicalText } from "./kernel/canonical-text";
export {
  ERROR_CATEGORIES,
  type ErrorCategory,
  EXIT_CODES,
  exitCodeFor,
  type InvalidIdentifierCode,
  InvalidIdentifierError,
  InvalidInputError,
  OperationCancelledError,
  SnagenticError,
  UNEXPECTED_ERROR_EXIT_CODE,
} from "./kernel/errors";
export { InstanceName } from "./kernel/instance-name";
export { HASH_EXCLUDED_FIELDS, recordHash } from "./kernel/record-hash";
export { redactSecrets } from "./kernel/redact";
export { ScopeName } from "./kernel/scope-name";
export { SESSION_USER } from "./kernel/session-user";
export { slug } from "./kernel/slug";
export { SysId } from "./kernel/sys-id";
export { TableName } from "./kernel/table-name";
export * from "./knowledge/index";
export {
  type Artifact,
  type ArtifactIdentity,
  artifactFromRow,
  type SecretFieldFinding,
} from "./metadata/domain/artifact";
export { Catalog, type CatalogData } from "./metadata/domain/catalog";
export {
  holdsCredentialValue,
  withoutCredentialValue,
} from "./metadata/domain/credential-values";
export {
  deniedAncestor,
  fileFields,
  isDeniedClass,
  secretFields,
  TEXT_TYPE_EXTENSIONS,
} from "./metadata/domain/field-rules";
export {
  InvalidRecordError,
  identityFolder,
  parseRecord,
  type RenderedRecord,
  recordAddress,
  recordBase,
  renderRecord,
} from "./metadata/domain/record-layout";
export {
  DEFAULT_REDACTION,
  fieldsToRedact,
  type PropertyValueVerdict,
  propertyValueVerdict,
  type RedactionPolicy,
} from "./metadata/domain/redaction";
export {
  mergeSecretPatterns,
  SECRET_PATTERN_IDS,
  type SecretDocumentScan,
  type SecretPatternId,
  type SecretRedaction,
  type SecretScan,
  scanDocumentSecrets,
  scanRowSecrets,
  scanSecrets,
  sortSecretRedactions,
} from "./metadata/domain/secret-scan";
export type { RecordStore, StoredRecord } from "./metadata/ports";
export * from "./plugins/index";
export { forEachConcurrently } from "./sync/application/concurrently";
export { type CatalogProgress, fetchCatalog } from "./sync/application/fetch-catalog";
export { type FingerprintOutcome, fetchFingerprints } from "./sync/application/fetch-fingerprints";
export type { IncrementalDependencies } from "./sync/application/incremental-dependencies";
export {
  type InstanceStatus,
  instanceStatus,
  type StatusDependencies,
} from "./sync/application/instance-status";
export {
  type KeysetListing,
  KeysetPager,
  type PagerSettings,
} from "./sync/application/keyset-pager";
export {
  type PullDependencies,
  type PullProgress,
  rawTimestamp,
} from "./sync/application/pull-dependencies";
export { type PullSummary, pullFull } from "./sync/application/pull-full";
export {
  FullPullRequiredError,
  type IncrementalSummary,
  type PullOptions,
  pullIncremental,
} from "./sync/application/pull-incremental";
export { inventorySignatures, pullOperational } from "./sync/application/pull-operational";
export {
  type ExistingSecretMigrationMirror,
  migrateExistingSecrets,
  SECRET_SCAN_VERSION,
  type SecretMigrationResult,
  scanCatalogSecrets,
} from "./sync/application/secret-migration";
export {
  catalogDigest,
  fetchTrustedCatalog,
  trustedCatalog,
} from "./sync/application/trusted-catalog";
export { NothingPulledError, PaginationStalledError } from "./sync/domain/errors";
export {
  changesSince,
  compareFingerprint,
  FINGERPRINT_SOURCES,
  type FingerprintChange,
  type TableFingerprint,
} from "./sync/domain/fingerprint";
export {
  INVENTORY,
  type InventorySignal,
  type InventorySource,
  inventorySignature,
} from "./sync/domain/inventory";
export {
  type Cursor,
  cursorOf,
  type KeysetFilter,
  type KeysetKind,
  keysetQuery,
  nextPageSize,
  PAGE_SIZE,
  type PageTiming,
} from "./sync/domain/keyset";
export {
  CHILD_TABLES,
  type ChildTable,
  childFamily,
  classesToPull,
  ownerOfBase,
  variableModelOf,
} from "./sync/domain/pull-scope";
export {
  chunks,
  isChildRowFile,
  needsNewCatalog,
  type RecordChanges,
  unexplainedLoss,
} from "./sync/domain/record-changes";
export {
  FIRST_REDACTION_VERSION,
  type Rereads,
  rereadsBetween,
} from "./sync/domain/redaction-upgrades";
export * from "./sync/domain/spilled-children";
export {
  minutesSince,
  nextCommand,
  type SyncFacts,
  type SyncPhase,
  syncPhase,
} from "./sync/domain/sync-phase";
export {
  childPrefixes,
  compareListing,
  type HiddenCounts,
  hasPrefix,
  hiddenKey,
  hiddenUnder,
  isHexPrefixed,
  LIST_LIMIT,
  type ListDifference,
  MAX_PREFIX,
  type MirroredRecord,
  mergeHidden,
  mirroredRecord,
  SPREAD_LIMIT,
  type VerifyStep,
  verifyStep,
} from "./sync/domain/verify-buckets";
export type {
  ExistingMirrorFile,
  Fingerprints,
  FinishedPull,
  IncrementalMirror,
  IntegrationOptions,
  IntegrationResult,
  LocalTrust,
  MirrorInspector,
  MirrorIntegrator,
  MirrorMode,
  MirrorSession,
  MirrorTree,
  MirrorView,
  MirrorWriter,
  PullCheckpoint,
  PullStateStore,
  SyncState,
  SyncStateStore,
} from "./sync/ports";
export * from "./sync/shared-index";
export * from "./updatesets/index";
export * from "./upgrade/index";
export { VERSION } from "./version";
export { initWorkspace } from "./workspace/application/init-workspace";
export {
  AGENT_HOSTS,
  type AgentHost,
  type AgentPack,
  type InstalledFile,
  type InstallStatus,
  installAgentPack,
} from "./workspace/application/install-agent-pack";
export { type LocatedWorkspace, locateWorkspace } from "./workspace/application/locate-workspace";
export { applyRepositoryTuning } from "./workspace/application/tune-repository";
export { withWorkspaceLock } from "./workspace/application/with-workspace-lock";
export {
  installedPackVersion,
  withAgentsImport,
  withInstructions,
} from "./workspace/domain/agent-pack";
export { withClaudeSettings } from "./workspace/domain/claude-settings";
export {
  DirectoryNotEmptyError,
  NestedRepositoryError,
  WorkspaceExistsError,
  WorkspaceLayoutError,
  WorkspaceLockedError,
  WorkspaceNotFoundError,
} from "./workspace/domain/errors";
export {
  FLUENT_SOURCE_DIR,
  fluentSourcePath,
  GITIGNORE,
  type InstancePaths,
  instancePaths,
  LOCAL_STATE_DIR,
  metadataPath,
} from "./workspace/domain/layout";
export {
  checkLayout,
  LAYOUT_VERSION,
  MANIFEST_FILE,
  manifestFor,
  type WorkspaceManifest,
} from "./workspace/domain/manifest";
export { withMcpServer } from "./workspace/domain/mcp-config";
export {
  checkMirrorScope,
  MirrorScopeError,
  type MirrorTreeEntry,
} from "./workspace/domain/mirror-scope";
export { protectedReason } from "./workspace/domain/protected-paths";
export type { RepositorySetting } from "./workspace/domain/repository-tuning";
export type {
  LockHolder,
  WorkspaceFiles,
  WorkspaceLock,
  WorkspaceStore,
} from "./workspace/ports";
