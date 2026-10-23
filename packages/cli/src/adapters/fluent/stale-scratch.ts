import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The scratch folders that hold records read from the instance: adopt's copy of the project,
// and the SDK worker's and transform's temporary folders. Each is removed when its command ends,
// but a crash or a kill leaves it behind (spec 012, B-21).
const INSTANCE_DATA = /^snagentic-(?:adopt|worker|sdk)-/;
const DAY_MS = 24 * 3_600_000;

// Removes such folders older than a day: none is still in use by then. Returns their paths.
export function sweepStaleScratch(
  root: string = tmpdir(),
  now: number = Date.now(),
  maxAgeMs: number = DAY_MS,
): string[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const swept: string[] = [];
  for (const name of names.filter((n) => INSTANCE_DATA.test(n))) {
    const path = join(root, name);
    try {
      const entry = statSync(path);
      if (!entry.isDirectory() || now - entry.mtimeMs < maxAgeMs) continue;
      rmSync(path, { recursive: true, force: true });
      swept.push(path);
    } catch {
      // Another process removed it, or it isn't ours to remove.
    }
  }
  return swept;
}
