// Public API of @snagentic/core. Other packages import only from here.
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
  TableQuery,
  TableStatistics,
} from "./connection/ports";
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
export { login, logout, resolveSecret } from "./instance/application/credentials";
export {
  addInstance,
  getInstance,
  listInstances,
  removeInstance,
} from "./instance/application/manage-instances";
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
export { forEachConcurrently } from "./sync/application/concurrently";
export { type CatalogProgress, fetchCatalog } from "./sync/application/fetch-catalog";
export { type FingerprintOutcome, fetchFingerprints } from "./sync/application/fetch-fingerprints";
export type { IncrementalDependencies } from "./sync/application/incremental-dependencies";
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
  pullIncremental,
} from "./sync/application/pull-incremental";
export { PaginationStalledError } from "./sync/domain/errors";
export {
  changesSince,
  compareFingerprint,
  FINGERPRINT_SOURCES,
  type FingerprintChange,
  type TableFingerprint,
} from "./sync/domain/fingerprint";
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
  OPERATIONAL_TABLES,
  type OperationalTable,
  ownerOfBase,
} from "./sync/domain/pull-scope";
export {
  chunks,
  isChildRowFile,
  needsNewCatalog,
  type RecordChanges,
} from "./sync/domain/record-changes";
export type {
  Fingerprints,
  FinishedPull,
  IncrementalMirror,
  IntegrationResult,
  MirrorIntegrator,
  MirrorMode,
  MirrorSession,
  MirrorTree,
  MirrorWriter,
  PullCheckpoint,
  SyncState,
  SyncStateStore,
} from "./sync/ports";
export { VERSION } from "./version";
export { initWorkspace } from "./workspace/application/init-workspace";
export { type LocatedWorkspace, locateWorkspace } from "./workspace/application/locate-workspace";
export {
  DirectoryNotEmptyError,
  NestedRepositoryError,
  WorkspaceExistsError,
  WorkspaceLayoutError,
  WorkspaceNotFoundError,
} from "./workspace/domain/errors";
export { GITIGNORE, type InstancePaths, instancePaths } from "./workspace/domain/layout";
export {
  checkLayout,
  LAYOUT_VERSION,
  MANIFEST_FILE,
  manifestFor,
  type WorkspaceManifest,
} from "./workspace/domain/manifest";
export type { WorkspaceStore } from "./workspace/ports";
