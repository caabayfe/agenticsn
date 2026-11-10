import { SnagenticError } from "../../kernel/errors";
import type { InstanceName } from "../../kernel/instance-name";
import { PULL_FOLDER } from "../../sync/domain/pull-state";
import { instancePaths } from "./layout";

// One path a mirror commit adds, changes or removes, with the git mode it has afterwards.
export interface MirrorTreeEntry {
  readonly path: string;
  readonly mode: string;
}

// A pull writes regular files only (fast-import, mode 100644). Removed paths have no mode.
const REGULAR_FILE = "100644";
const REMOVED = "000000";
const NAMED = 3;

// servicenow-remote/<name> is the instance's copy, and anyone who can push it reaches every clone
// that integrates it. A mirror commit that holds anything a pull never writes (agent settings,
// workflows, links, submodules) is refused before it reaches a branch or the working tree.
export class MirrorScopeError extends SnagenticError {
  readonly paths: readonly string[];

  constructor(instance: InstanceName, paths: readonly string[]) {
    const more = paths.length > NAMED ? `, and ${paths.length - NAMED} more` : "";
    super(
      "mirror-outside-scope",
      "precondition",
      `servicenow-remote/${instance} holds ${paths.length} path(s) a pull never writes: ${paths.slice(0, NAMED).join(", ")}${more}; nothing was taken from it`,
      `a pull writes only regular files under instances/${instance}/{metadata,operational,${PULL_FOLDER}}: check who pushed the branch, and restore it from a pull (snagentic pull ${instance} --full)`,
    );
    this.paths = paths;
  }
}

function prefixes(instance: InstanceName): readonly string[] {
  const paths = instancePaths(instance);
  return [paths.metadata, paths.operational, `${paths.root}/${PULL_FOLDER}`].map((p) => `${p}/`);
}

// Throws unless every entry is a regular file (or a removal) inside the folders a pull writes.
export function checkMirrorScope(instance: InstanceName, entries: Iterable<MirrorTreeEntry>): void {
  const allowed = prefixes(instance);
  const refused: string[] = [];
  for (const { path, mode } of entries) {
    const inside = allowed.some((prefix) => path.startsWith(prefix));
    if (!inside || (mode !== REGULAR_FILE && mode !== REMOVED)) refused.push(path);
  }
  if (refused.length > 0) throw new MirrorScopeError(instance, refused);
}
