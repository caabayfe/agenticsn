import { missingSettings, tuningCommands, type WorkspaceStore } from "../../workspace/index";
import type { Check } from "../domain/check";

const NAME = "git-tuning";

// Whether this clone has the large-repository settings: a plain `git clone` has none, and
// git status on a large mirror is then several times slower (spec 014, PERF2-04).
export async function checkRepositoryTuning(
  store: Pick<WorkspaceStore, "repositoryTuning">,
  root: string,
): Promise<Check> {
  const settings = await store.repositoryTuning(root);
  if (settings === null) {
    return { name: NAME, status: "unavailable", detail: "not a git repository", hint: null };
  }
  const missing = missingSettings(settings);
  if (missing.length === 0) {
    const detail = settings.map(({ key, current }) => `${key}=${current}`).join(", ");
    return { name: NAME, status: "ok", detail, hint: null };
  }
  return {
    name: NAME,
    status: "warn",
    detail: `this clone lacks ${missing.map((setting) => setting.key).join(", ")}`,
    hint:
      "snagentic integrate or pull sets them in this repository's config; or run " +
      tuningCommands(missing),
  };
}
