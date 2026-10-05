// Public API of @snagentic/core. Other packages import only from here.
export { runDoctor } from "./environment/application/run-doctor";
export {
  CHECK_STATUSES,
  type Check,
  type CheckStatus,
  type DoctorReport,
  summarizeChecks,
} from "./environment/domain/check";
export type { EnvironmentProbe } from "./environment/ports";
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
