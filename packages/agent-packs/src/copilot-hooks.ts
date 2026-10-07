import { CLAUDE_SETTINGS } from "./claude-settings";

// GitHub Copilot's hooks file, .github/hooks/snagentic.json (ADR-0011, layer 1). Copilot CLI
// and the Copilot cloud agent read it. With Claude's PascalCase event names, Copilot applies
// Claude's matchers and sends Claude's payload, so the same hook commands handle it (checked
// with Copilot CLI 1.0.92). Copilot lets the tool run when a hook times out, so the timeout is
// generous.
const TIMEOUT_SEC = 120;

type Event = keyof typeof CLAUDE_SETTINGS.hooks;

const entries = (event: Event) =>
  CLAUDE_SETTINGS.hooks[event].flatMap((group) =>
    group.hooks.map((hook) => ({
      type: "command" as const,
      ...("matcher" in group ? { matcher: group.matcher } : {}),
      command: hook.command,
      timeoutSec: TIMEOUT_SEC,
    })),
  );

export const COPILOT_HOOKS = {
  version: 1,
  hooks: {
    PreToolUse: entries("PreToolUse"),
    PostToolUse: entries("PostToolUse"),
    Stop: entries("Stop"),
  },
} as const;

export const COPILOT_HOOKS_PATH = ".github/hooks/snagentic.json";
