// Public API of the workspace context: layout, manifest, agent packs, repository tuning and the
// workspace lock.
export { initWorkspace } from "./application/init-workspace";
export {
  AGENT_HOSTS,
  type AgentHost,
  type AgentPack,
  type InstalledFile,
  type InstallStatus,
  installAgentPack,
} from "./application/install-agent-pack";
export { type LocatedWorkspace, locateWorkspace } from "./application/locate-workspace";
export { applyRepositoryTuning } from "./application/tune-repository";
export { withWorkspaceLock } from "./application/with-workspace-lock";
export {
  installedPackVersion,
  withAgentsImport,
  withInstructions,
} from "./domain/agent-pack";
export { withClaudeSettings } from "./domain/claude-settings";
export {
  DirectoryNotEmptyError,
  NestedRepositoryError,
  WorkspaceExistsError,
  WorkspaceLayoutError,
  WorkspaceLockedError,
  WorkspaceNotFoundError,
} from "./domain/errors";
export {
  FLUENT_SOURCE_DIR,
  fluentSourcePath,
  GITIGNORE,
  type InstancePaths,
  instancePaths,
  LOCAL_STATE_DIR,
  metadataPath,
} from "./domain/layout";
export {
  checkLayout,
  LAYOUT_VERSION,
  MANIFEST_FILE,
  manifestFor,
  type WorkspaceManifest,
} from "./domain/manifest";
export { withMcpServer } from "./domain/mcp-config";
export {
  hasMirrorAttributes,
  MIRROR_ATTRIBUTES_RULE,
  withMirrorAttributes,
} from "./domain/mirror-attributes";
export {
  checkMirrorScope,
  MirrorScopeError,
  type MirrorTreeEntry,
} from "./domain/mirror-scope";
export { protectedReason } from "./domain/protected-paths";
export {
  missingSettings,
  type RepositorySetting,
  tuningCommands,
} from "./domain/repository-tuning";
export type {
  LockHolder,
  WorkspaceFiles,
  WorkspaceLock,
  WorkspaceStore,
} from "./ports";
