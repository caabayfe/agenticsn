import { existsSync, statSync } from "node:fs";

export interface TimedRun {
  readonly milliseconds: number;
  readonly exitCode: number;
  readonly stdout: string;
}

export function timedRun(command: readonly string[]): TimedRun {
  const started = performance.now();
  const result = Bun.spawnSync([...command], { stdout: "pipe", stderr: "pipe" });
  return {
    milliseconds: performance.now() - started,
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
  };
}

// Bun appends .exe when compiling on Windows.
export function resolveBinary(path: string): string {
  return process.platform === "win32" && !path.endsWith(".exe") && existsSync(`${path}.exe`)
    ? `${path}.exe`
    : path;
}

export function sizeInMegabytes(path: string): number {
  return Math.round((statSync(path).size / 1024 / 1024) * 10) / 10;
}

// Readable through GitHub's public annotations API, so results don't need artifact access.
export function annotate(title: string, message: string): void {
  if (process.env["GITHUB_ACTIONS"] === "true") {
    console.log(`::notice title=${title}::${message}`);
  }
}

export function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined) {
    throw new Error(`missing --${name}`);
  }
  return value;
}
