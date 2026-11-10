import { missingSettings } from "../domain/repository-tuning";
import type { WorkspaceStore } from "../ports";

type TuningStore = Pick<WorkspaceStore, "repositoryTuning" | "tuneRepository">;

// Sets the large-repository settings the workspace's repository lacks, in its own config,
// never the person's global one. The keys it set; none outside a git repository.
export async function applyRepositoryTuning(
  store: TuningStore,
  root: string,
): Promise<readonly string[]> {
  const missing = missingSettings((await store.repositoryTuning(root)) ?? []);
  if (missing.length === 0) {
    return [];
  }
  await store.tuneRepository(root, missing);
  return missing.map((setting) => setting.key);
}
