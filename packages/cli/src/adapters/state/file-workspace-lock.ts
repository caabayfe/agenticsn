import { randomUUID } from "node:crypto";
import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { LockHolder, WorkspaceLock } from "@snagentic/core";
import { z } from "zod";
import { readStateText } from "./state-file";

const LockFile = z.object({
  command: z.string(),
  pid: z.number().int().positive(),
  host: z.string(),
  started: z.string(),
  // Which claim wrote it, so release never removes another run's lock.
  token: z.string().optional(),
});
type LockFile = z.infer<typeof LockFile>;

type Claim = { readonly acquired: true } | { readonly acquired: false; holder: LockHolder | null };

function parse(text: string | null): LockFile | null {
  if (text === null) return null;
  try {
    const parsed = LockFile.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const holderOf = (file: LockFile | null): LockHolder | null =>
  file === null
    ? null
    : { command: file.command, pid: file.pid, host: file.host, started: file.started };

// A process of this machine that no longer runs. A lock from another machine (a shared disk)
// is never judged stale: its process cannot be checked from here.
function ended(file: LockFile | null): boolean {
  if (file === null || file.host !== hostname()) return false;
  try {
    process.kill(file.pid, 0);
    return false;
  } catch (error) {
    // EPERM: the process runs, under another user.
    return Reflect.get(Object(error), "code") === "ESRCH";
  }
}

// Moves a stale lock out of the way, checking it is still the one judged stale: a command that
// took it over meanwhile gets its lock back. False when it is gone or no longer stale.
export async function setAsideStale(path: string, stale: string, aside: string): Promise<boolean> {
  try {
    await rename(path, aside);
  } catch {
    return false;
  }
  const moved = await readStateText(aside);
  if (moved !== stale) {
    try {
      await link(aside, path);
    } catch {
      // A third command holds the lock now; the one moved aside was released meanwhile.
    }
  }
  await rm(aside, { force: true });
  return moved === stale;
}

// .snagentic/<name>/workspace.lock: written whole to a temporary file, then linked into place,
// which fails when the lock exists, so a claim is atomic and the file is never half written.
// A lock left by a process that ended (a second Ctrl-C, a closed terminal) holds nothing.
export class FileWorkspaceLock implements WorkspaceLock {
  private readonly path: string;
  private readonly token = randomUUID();

  constructor(private readonly directory: string) {
    this.path = join(directory, "workspace.lock");
  }

  async acquire(command: string, started: string): Promise<Claim> {
    await mkdir(this.directory, { recursive: true });
    const mine: LockFile = {
      command,
      pid: process.pid,
      host: hostname(),
      started,
      token: this.token,
    };
    if (await this.create(mine)) return { acquired: true };
    const text = await readStateText(this.path);
    if (
      text !== null &&
      ended(parse(text)) &&
      (await setAsideStale(this.path, text, `${this.path}.${this.token}`)) &&
      (await this.create(mine))
    ) {
      return { acquired: true };
    }
    return { acquired: false, holder: holderOf(parse(await readStateText(this.path))) };
  }

  private async create(file: LockFile): Promise<boolean> {
    const temporary = `${this.path}.${this.token}.tmp`;
    await writeFile(temporary, `${JSON.stringify(file)}\n`);
    try {
      await link(temporary, this.path);
      return true;
    } catch {
      return false;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async release(): Promise<void> {
    if (parse(await readStateText(this.path))?.token === this.token) {
      await rm(this.path, { force: true });
    }
  }
}
