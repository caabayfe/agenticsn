// Public API of @snagentic/core. Other packages import only from here.

export * from "./advice/index";
export { measureServerCost } from "./connection/application/measure-server-cost";
export {
  ConcurrencyController,
  type ConcurrencySettings,
  type ResponseSignal,
} from "./connection/domain/concurrency-controller";
export {
  AccessDeniedError,
  AuthenticationFailedError,
  InstanceError,
  InstanceUnreachableError,
  RequestBudgetExhaustedError,
} from "./connection/domain/errors";
export {
  type HttpMethod,
  type RequestOutcome,
  type RetryDecision,
  type RetryInput,
  retryDecision,
} from "./connection/domain/retry-policy";
export { parseServerTiming } from "./connection/domain/server-timing";
export type {
  ConnectionStats,
  InstanceReader,
  Row,
  ServerCost,
  ServerCostReader,
  TableQuery,
  TableStatistics,
} from "./connection/ports";
export * from "./delivery/index";
export { checkAgentPack } from "./environment/application/check-agent-pack";
export { runDoctor } from "./environment/application/run-doctor";
export { runInstanceChecks } from "./environment/application/run-instance-checks";
export {
  CHECK_STATUSES,
  type Check,
  type CheckStatus,
  type DoctorReport,
  summarizeChecks,
} from "./environment/domain/check";
export type { EnvironmentProbe } from "./environment/ports";
export * from "./governance/index";
export { login, logout, resolveSecret } from "./instance/application/credentials";
export {
  addInstance,
  getInstance,
  listInstances,
  removeInstance,
} from "./instance/application/manage-instances";
export {
  DevelopmentInstanceRequiredError,
  ensureDevelopmentInstance,
  ReadOnlyCredentialRequiredError,
  verifyReadOnlyCredential,
} from "./instance/application/verify-access";
export {
  CredentialsMissingError,
  InstanceExistsError,
  InstanceNotFoundError,
  InstanceUrlExistsError,
  InvalidInstanceUrlError,
  ReadOnlyAcknowledgementRequiredError,
} from "./instance/domain/errors";
export { normalizeInstanceUrl } from "./instance/domain/instance-url";
export {
  type AuthSettings,
  type BasicAuth,
  canWrite,
  createProfile,
  credentialAccount,
  credentialVariable,
  INSTANCE_KINDS,
  type InstanceKind,
  type InstanceProfile,
  instanceHost,
  type NewProfile,
} from "./instance/domain/profile";
export type { CredentialStore, ProfileStore } from "./instance/ports";
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
export { slug } from "./kernel/slug";
export { SysId } from "./kernel/sys-id";
export { TableName } from "./kernel/table-name";
export * from "./knowledge/index";
export { type Artifact, type ArtifactIdentity, artifactFromRow } from "./metadata/domain/artifact";
export { Catalog, type CatalogData } from "./metadata/domain/catalog";
export {
  fileFields,
  isDeniedClass,
  secretFields,
  TEXT_TYPE_EXTENSIONS,
} from "./metadata/domain/field-rules";
export {
  InvalidRecordError,
  parseRecord,
  type RenderedRecord,
  recordBase,
  renderRecord,
} from "./metadata/domain/record-layout";
export {
  DEFAULT_REDACTION,
  fieldsToRedact,
  type RedactionPolicy,
} from "./metadata/domain/redaction";
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
export { completePull, type PullSummary, pullFull } from "./sync/application/pull-full";
export {
  FullPullRequiredError,
  type IncrementalSummary,
  type PullOptions,
  pullIncremental,
} from "./sync/application/pull-incremental";
export { inventorySignatures, pullOperational } from "./sync/application/pull-operational";
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
  type AttachedChildren,
  attachChildren,
  CHILD_TABLES,
  type ChildTable,
  childFamily,
  childGrouper,
  classesToPull,
  ownerOfBase,
} from "./sync/domain/pull-scope";
export {
  chunks,
  isChildRowFile,
  needsNewCatalog,
  type RecordChanges,
  unexplainedLoss,
} from "./sync/domain/record-changes";
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
  Fingerprints,
  FinishedPull,
  IncrementalMirror,
  IntegrationResult,
  MirrorInspector,
  MirrorIntegrator,
  MirrorMode,
  MirrorSession,
  MirrorTree,
  MirrorView,
  MirrorWriter,
  PullCheckpoint,
  SyncState,
  SyncStateStore,
} from "./sync/ports";
export * from "./updatesets/index";
export { VERSION } from "./version";
export { initWorkspace } from "./workspace/application/init-workspace";
export {
  type AgentPack,
  type InstalledFile,
  type InstallStatus,
  installAgentPack,
} from "./workspace/application/install-agent-pack";
export { type LocatedWorkspace, locateWorkspace } from "./workspace/application/locate-workspace";
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
  WorkspaceNotFoundError,
} from "./workspace/domain/errors";
export {
  GITIGNORE,
  type InstancePaths,
  instancePaths,
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
export { protectedReason } from "./workspace/domain/protected-paths";
export type { WorkspaceFiles, WorkspaceStore } from "./workspace/ports";
