import { describe, expect, it } from "bun:test";
import { CLAUDE_SETTINGS } from "../src/claude-settings";
import { COPILOT_HOOKS } from "../src/copilot-hooks";

// Copilot CLI reads .github/hooks/*.json. With Claude's PascalCase event names it applies
// Claude's matchers and sends Claude's payload, so `snagentic hook claude` handles it
// (checked with Copilot CLI 1.0.92).
describe("Copilot hooks", () => {
  it("run the same checks as the Claude Code hooks, on the same tools", () => {
    expect(COPILOT_HOOKS.version).toBe(1);
    const flat = (event: keyof typeof CLAUDE_SETTINGS.hooks) =>
      CLAUDE_SETTINGS.hooks[event].flatMap((group) =>
        group.hooks.map((hook) => ({
          matcher: "matcher" in group ? group.matcher : undefined,
          command: hook.command,
        })),
      );
    for (const event of ["PreToolUse", "PostToolUse", "Stop"] as const) {
      expect(
        COPILOT_HOOKS.hooks[event].map(({ matcher, command }) => ({ matcher, command })),
      ).toEqual(flat(event));
    }
  });

  it("give every check enough time, because a timed-out hook lets the tool run", () => {
    for (const entries of Object.values(COPILOT_HOOKS.hooks)) {
      for (const entry of entries) {
        expect(entry.type).toBe("command");
        expect(entry.timeoutSec).toBeGreaterThanOrEqual(60);
      }
    }
  });
});
