import type { EnvironmentProbe } from "@snagentic/core";
import { failedCheck, okCheck } from "./check-results";

export interface GitVersionResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type RunGitVersion = () => Promise<GitVersionResult>;

const NAME = "git";
const MINIMUM = { major: 2, minor: 30 } as const;
const INSTALL_HINT = "install git 2.30 or newer and make sure it is on PATH";

async function spawnGitVersion(): Promise<GitVersionResult> {
  const process = Bun.spawn(["git", "--version"], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(process.stdout).text();
  return { exitCode: await process.exited, stdout };
}

export function gitProbe(runGitVersion: RunGitVersion = spawnGitVersion): EnvironmentProbe {
  return {
    name: NAME,
    async run() {
      let result: GitVersionResult;
      try {
        result = await runGitVersion();
      } catch {
        return failedCheck(NAME, "git was not found", INSTALL_HINT);
      }
      const line = result.stdout.trim();
      if (result.exitCode !== 0) {
        return failedCheck(NAME, `git --version exited with ${result.exitCode}`, INSTALL_HINT);
      }
      const match = /^git version (\d+)\.(\d+)/.exec(line);
      if (match === null) {
        return failedCheck(NAME, `unrecognised git version output: ${line}`, INSTALL_HINT);
      }
      const major = Number(match[1]);
      const minor = Number(match[2]);
      if (major < MINIMUM.major || (major === MINIMUM.major && minor < MINIMUM.minor)) {
        return failedCheck(NAME, `${line} is older than 2.30`, "upgrade git to 2.30 or newer");
      }
      return okCheck(NAME, line);
    },
  };
}
