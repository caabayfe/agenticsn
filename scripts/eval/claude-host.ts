import { dirname, join } from "node:path";
import type { Variant } from "./types";

export interface HostOptions {
  readonly model: string;
  readonly budgetUsd: number;
  readonly timeoutSeconds: number;
  readonly binary: string;
}

// Tools the agent may use without asking: files, the snagentic MCP tools and CLI, and git.
// Anything else is denied, as a headless run has nobody to ask.
const ALLOWED = [
  "Read",
  "Edit",
  "Write",
  "MultiEdit",
  "Glob",
  "Grep",
  "Skill",
  "TodoWrite",
  "mcp__snagentic",
  "Bash(snagentic:*)",
  "Bash(git:*)",
  "Bash(ls:*)",
];

// The environment of a run: no instance passwords, and the snagentic under test on the PATH.
function environment(slot: string, binary: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^SNAGENTIC_.*PASSWORD$/.test(key)) {
      env[key] = value;
    }
  }
  return { ...env, SNAGENTIC_WORKSPACE: slot, PATH: `${dirname(binary)}:${env["PATH"] ?? ""}` };
}

// One turn, stopped when it runs out of time: what it streamed so far is kept and scored.
async function runTurn(
  command: readonly string[],
  cwd: string,
  env: Record<string, string>,
  timeoutSeconds: number,
): Promise<{ stream: string; timedOut: boolean }> {
  const child = Bun.spawn([...command], { cwd, env, stdout: "pipe", stderr: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutSeconds * 1000);
  const stream = await new Response(child.stdout).text();
  await child.exited;
  clearTimeout(timer);
  return { stream, timedOut };
}

const sessionOf = (stream: string) => /"session_id":"([^"]+)"/.exec(stream)?.[1] ?? null;

// Runs the user's turns through Claude Code in headless mode, one process per turn, resuming
// the session; returns each turn's stream-json output.
export async function runClaude(
  slot: string,
  turns: readonly string[],
  variant: Variant,
  options: HostOptions,
): Promise<string[]> {
  const mcpConfig = join(slot, ".git", "eval-mcp.json");
  await Bun.write(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        snagentic: { command: options.binary, args: ["mcp"], env: { SNAGENTIC_WORKSPACE: slot } },
      },
    }),
  );
  const streams: string[] = [];
  let session: string | null = null;
  for (const message of turns) {
    const command: string[] = [
      "claude",
      "-p",
      message,
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      options.model,
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      ...(variant.mcp ? ["--mcp-config", mcpConfig] : []),
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      ...ALLOWED,
      "--max-budget-usd",
      String(options.budgetUsd),
      ...(session === null ? [] : ["--resume", session]),
    ];
    const outcome = await runTurn(
      command,
      slot,
      environment(slot, options.binary),
      options.timeoutSeconds,
    );
    streams.push(outcome.stream);
    session = sessionOf(outcome.stream) ?? session;
    if (outcome.timedOut) {
      break;
    }
  }
  return streams;
}
