import type { WorkspaceManifest } from "./domain/manifest";
import type { RepositorySetting } from "./domain/repository-tuning";

export interface WorkspaceStore {
  // The directory itself first, then each parent up to the file-system root.
  ancestorsOf(directory: string): readonly string[];
  // The parsed manifest of a workspace root, or null when the directory has none.
  readManifest(directory: string): Promise<unknown | null>;
  isInsideGitRepository(directory: string): Promise<boolean>;
  isEmptyOrMissing(directory: string): Promise<boolean>;
  // Writes the manifest and .gitignore, initializes and tunes the git repository.
  create(directory: string, manifest: WorkspaceManifest): Promise<void>;
  // The large-repository settings for this machine, with the value git resolves for each;
  // null when the directory is not in a git repository.
  repositoryTuning(directory: string): Promise<readonly RepositorySetting[] | null>;
  // Sets them in the repository's own config (git config --local), never the global one.
  tuneRepository(
    directory: string,
    settings: readonly Pick<RepositorySetting, "key" | "value">[],
  ): Promise<void>;
}

// Text files in a workspace, by absolute path.
export interface WorkspaceFiles {
  // The file's content, or null when there is none.
  read(path: string): Promise<string | null>;
  write(path: string, content: string, options?: { readonly executable?: boolean }): Promise<void>;
  // Removes the file; nothing when there is none.
  remove(path: string): Promise<void>;
  // The names of the directory's files, sorted; none when there is no such directory.
  list(directory: string): Promise<readonly string[]>;
}

// Who holds a workspace lock, so a refused command can name it.
export interface LockHolder {
  readonly command: string;
  readonly pid: number;
  readonly host: string;
  readonly started: string;
}

// The lock of one instance in one workspace (.snagentic/<name>/), held by every command that
// writes its mirror, its profile or the instance, so two never interleave; or the workspace's
// own lock (.snagentic/), held by commands that write the workspace but no instance (REL-03).
export interface WorkspaceLock {
  // Takes the lock for `command`. When another run holds it: who, or null when unreadable.
  acquire(
    command: string,
    started: string,
  ): Promise<{ readonly acquired: true } | { readonly acquired: false; holder: LockHolder | null }>;
  // Gives back a lock this run took; another run's lock is left alone.
  release(): Promise<void>;
}
