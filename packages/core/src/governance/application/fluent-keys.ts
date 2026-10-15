import type { FluentProject } from "../domain/fluent-findings";
import { addedKeys } from "../domain/fluent-keys";
import type { FluentProjects } from "../ports";

export interface FluentKeysResult {
  readonly projects: number;
  // Projects whose keys.ts was written, with the IDs it gained.
  readonly written: readonly { readonly path: string; readonly added: readonly string[] }[];
  // Projects that do not build: their keys wait until validate's errors are fixed.
  readonly notBuilt: readonly string[];
}

// Writes the keys.ts each changed Fluent project's build produces (P5, spec 005): a new Now.ID
// gets its random sys_id once, and the file is committed with the source, so every later build
// names the record the same. `paths` (workspace-relative) narrows it to the projects holding
// them; otherwise every project changed since HEAD (staged ones, in the pre-commit hook).
export async function writeFluentKeys(
  fluent: FluentProjects,
  paths: readonly string[] | undefined,
): Promise<FluentKeysResult> {
  const projects: readonly FluentProject[] =
    paths === undefined ? await fluent.changedSince("HEAD") : await fluent.holding(paths);
  const written: { path: string; added: string[] }[] = [];
  const notBuilt: string[] = [];
  for (const project of projects) {
    const build = await fluent.build(project);
    if (!build.built) notBuilt.push(project.path);
    else if (build.keys !== null) {
      await fluent.writeKeys(project, build.keys.built);
      written.push({
        path: project.path,
        added: addedKeys(build.keys.committed, build.keys.built),
      });
    }
  }
  return { projects: projects.length, written, notBuilt };
}
