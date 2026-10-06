import { Argument, type Command } from "commander";
import { executeUseCase } from "../registry/execute";
import type { UseCase, UseCaseContext } from "../registry/use-case";
import {
  CLAUDE_HOOK_EVENTS,
  type ClaudeHookEvent,
  type HookOutcome,
  runClaudeHook,
} from "./claude-hooks";

const isEvent = (value: string): value is ClaudeHookEvent =>
  CLAUDE_HOOK_EVENTS.some((event) => event === value);

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// `snagentic hook <host> <event>`: what agent install configures hosts to run.
export function addHookCommand(
  program: Command,
  useCases: readonly UseCase[],
  context: () => UseCaseContext,
  readStdin: () => Promise<string>,
  done: (outcome: HookOutcome) => void,
): void {
  program
    .command("hook")
    .description(
      "Run a coding-agent host hook (agent install configures them). Reads the host's JSON on stdin.",
    )
    .addArgument(new Argument("<host>", "the agent host").choices(["claude"]))
    .addArgument(new Argument("<event>", "the hook event").choices(CLAUDE_HOOK_EVENTS))
    .action(async (_host: string, event: string) => {
      const run = async (name: string, input: Record<string, unknown>) => {
        const useCase = useCases.find((candidate) => candidate.name === name);
        if (useCase === undefined) {
          throw new Error(`no ${name} command`);
        }
        return (await executeUseCase(useCase, input, context())).output;
      };
      const payload = parsed(await readStdin());
      done(
        isEvent(event)
          ? await runClaudeHook(event, payload, run)
          : { exitCode: 0, stdout: "", stderr: "" },
      );
    });
}
