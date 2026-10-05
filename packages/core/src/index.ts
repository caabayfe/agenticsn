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
export type { ConnectionStats, InstanceReader, Row, TableQuery } from "./connection/ports";
export { runDoctor } from "./environment/application/run-doctor";
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
