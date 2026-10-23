import { childEnvironment } from "./child-environment";

export interface GhResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export const GH_NOT_INSTALLED = "the GitHub CLI (gh) is not installed";

// The CLI's own explanation: its first line of error output.
export const ghReason = (result: GhResult) =>
  result.stderr.trim().split("\n")[0] || `gh exited with code ${result.exitCode}`;

export interface GhRun {
  readonly executable: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

// The GitHub CLI's output, or null when it is not installed. gh's own sign-in (or GH_TOKEN) is
// used as is, so snagentic never sees a token (ADR-0022), and it never prompts. A timeout or
// cancellation kills it, which reads as a failed call.
export async function runGh(args: readonly string[], run: GhRun): Promise<GhResult | null> {
  let child: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  try {
    child = Bun.spawn([run.executable, ...args], {
      cwd: run.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: run.signal,
      timeout: run.timeoutMs,
      env: childEnvironment({ GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" }),
    });
  } catch {
    return null;
  }
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (child.signalCode !== null) {
    // Killed: a process gh started may still hold its output open, so don't wait for it.
    return { exitCode: 1, stdout: "", stderr: "gh did not answer in time, or was cancelled" };
  }
  return { exitCode, stdout: await stdout, stderr: await stderr };
}
