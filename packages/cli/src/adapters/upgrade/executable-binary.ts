import { existsSync } from "node:fs";
import { chmod, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { BinaryNotReplacedError, type InstalledBinary } from "@snagentic/core";
import { childEnvironment } from "../child-environment";

// The executable when it is a release binary; null when snagentic runs from source (bun).
export function installedPath(executable: string): string | null {
  const name = basename(executable.replaceAll("\\", "/")).toLowerCase();
  return name.startsWith("snagentic") ? executable : null;
}

async function runFile(path: string, args: readonly string[], cwd: string) {
  const child = Bun.spawn([path, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: childEnvironment(),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

// Windows won't remove or replace a file a process runs, but lets it be renamed. The current
// binary moves to <name>.old; while an earlier <name>.old still runs (an MCP server started
// before the last upgrade), to <name>.<time>.old instead. Copies no longer running are removed.
async function moveAside(path: string): Promise<void> {
  const dir = dirname(path);
  const name = basename(path);
  const copies = (await readdir(dir)).filter((n) => n.startsWith(`${name}.`) && n.endsWith(".old"));
  // A copy a process still runs stays, for the upgrade after it ends.
  await Promise.allSettled(copies.map((n) => rm(join(dir, n), { force: true })));
  const aside = existsSync(`${path}.old`) ? `${path}.${Date.now()}.old` : `${path}.old`;
  await rename(path, aside);
}

// The running snagentic executable (ADR-0023). A new binary is written beside it, must run and
// report the expected version, and only then takes its place with a rename. On Windows the old
// one moves aside first (moveAside).
export class ExecutableBinary implements InstalledBinary {
  constructor(
    readonly path: string | null,
    private readonly platform: string = process.platform,
  ) {}

  async replace(binary: Uint8Array, version: string): Promise<void> {
    const path = this.path;
    if (path === null) {
      throw new BinaryNotReplacedError("snagentic", "it is not an installed release");
    }
    const windows = this.platform === "win32";
    const staged = join(dirname(path), `.snagentic-upgrade-${process.pid}${windows ? ".exe" : ""}`);
    try {
      await writeFile(staged, binary);
      await chmod(staged, 0o755);
      const ran = await runFile(staged, ["--version"], dirname(path));
      if (ran.exitCode !== 0 || !ran.stdout.includes(`snagentic ${version}`)) {
        throw new BinaryNotReplacedError(path, `the downloaded binary does not run as ${version}`);
      }
      if (windows) await moveAside(path);
      await rename(staged, path);
    } catch (error) {
      await rm(staged, { force: true });
      if (error instanceof BinaryNotReplacedError) {
        throw error;
      }
      throw new BinaryNotReplacedError(
        path,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  run(args: readonly string[], cwd: string) {
    if (this.path === null) {
      throw new BinaryNotReplacedError("snagentic", "it is not an installed release");
    }
    return runFile(this.path, args, cwd);
  }
}
