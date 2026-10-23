import {
  type PullRequestLookup,
  type PullRequests,
  PullRequestUnavailableError,
} from "@snagentic/core";
import { GH_NOT_INSTALLED, type GhResult, ghReason, runGh } from "../run-gh";

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
      return { kind: "unavailable", reason: GH_NOT_INSTALLED };
    }
    if (result.exitCode !== 0) {
      return { kind: "unavailable", reason: ghReason(result) };
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
      throw new PullRequestUnavailableError(GH_NOT_INSTALLED);
    }
    const url = result.stdout.trim().split("\n").at(-1) ?? "";
    if (result.exitCode !== 0 || !/^https?:\/\//.test(url)) {
      throw new PullRequestUnavailableError(ghReason(result));
    }
    return url;
  }

  private run(args: readonly string[], signal: AbortSignal): Promise<GhResult | null> {
    return runGh(args, {
      executable: this.executable,
      cwd: this.root,
      timeoutMs: this.timeoutMs,
      signal,
    });
  }
}
