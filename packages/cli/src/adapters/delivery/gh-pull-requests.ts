import {
  type PullRequestLookup,
  type PullRequests,
  PullRequestUnavailableError,
} from "@snagentic/core";

interface GhResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const NOT_INSTALLED = "the GitHub CLI (gh) is not installed";

// The CLI's own explanation: its first line of error output.
const reasonOf = (result: GhResult) =>
  result.stderr.trim().split("\n")[0] || `gh exited with code ${result.exitCode}`;

// GitHub through its CLI (ADR-0022): gh's own sign-in (or GH_TOKEN) is used as is, so
// snagentic never sees a token. Never prompts; every call is bounded by a timeout.
export class GhPullRequests implements PullRequests {
  constructor(
    readonly root: string,
    readonly executable = "gh",
    private readonly timeoutMs = 15_000,
  ) {}

  async find(branch: string, signal: AbortSignal): Promise<PullRequestLookup> {
    const args = ["pr", "list", "--head", branch, "--state", "open", "--json", "url"];
    const result = await this.run([...args, "--limit", "1"], signal);
    if (result === null) {
      return { kind: "unavailable", reason: NOT_INSTALLED };
    }
    if (result.exitCode !== 0) {
      return { kind: "unavailable", reason: reasonOf(result) };
    }
    try {
      const listed: unknown = JSON.parse(result.stdout);
      const first: unknown = Array.isArray(listed) ? listed[0] : undefined;
      if (first === undefined) {
        return { kind: "none" };
      }
      const url = typeof first === "object" && first !== null ? Reflect.get(first, "url") : null;
      if (typeof url === "string") {
        return { kind: "found", url };
      }
    } catch {
      // Reported below, like any other answer gh should not give.
    }
    return { kind: "unavailable", reason: "gh gave an answer snagentic cannot read" };
  }

  async defaultBranch(signal: AbortSignal): Promise<string | null> {
    const args = ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"];
    const result = await this.run(args, signal);
    const name = result?.exitCode === 0 ? result.stdout.trim() : "";
    return name === "" ? null : name;
  }

  async openDraft(
    request: { readonly branch: string; readonly title: string; readonly body: string },
    signal: AbortSignal,
  ): Promise<string> {
    const { branch, title, body } = request;
    const args = ["pr", "create", "--draft", "--head", branch, "--title", title, "--body", body];
    const result = await this.run(args, signal);
    if (result === null) {
      throw new PullRequestUnavailableError(NOT_INSTALLED);
    }
    const url = result.stdout.trim().split("\n").at(-1) ?? "";
    if (result.exitCode !== 0 || !/^https?:\/\//.test(url)) {
      throw new PullRequestUnavailableError(reasonOf(result));
    }
    return url;
  }

  // gh's output, or null when it is not installed. A timeout or cancellation kills it, which
  // reads as a failed call.
  private async run(args: readonly string[], signal: AbortSignal): Promise<GhResult | null> {
    let child: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
    try {
      child = Bun.spawn([this.executable, ...args], {
        cwd: this.root,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        signal,
        timeout: this.timeoutMs,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" },
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
}
