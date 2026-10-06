import type { WorkspaceManifest } from "./domain/manifest";

export interface WorkspaceStore {
  // The directory itself first, then each parent up to the file-system root.
  ancestorsOf(directory: string): readonly string[];
  // The parsed manifest of a workspace root, or null when the directory has none.
  readManifest(directory: string): Promise<unknown | null>;
  isInsideGitRepository(directory: string): Promise<boolean>;
  isEmptyOrMissing(directory: string): Promise<boolean>;
  // Writes the manifest and .gitignore, initializes and tunes the git repository.
  create(directory: string, manifest: WorkspaceManifest): Promise<void>;
}

// Text files in a workspace, by absolute path.
export interface WorkspaceFiles {
  // The file's content, or null when there is none.
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}
