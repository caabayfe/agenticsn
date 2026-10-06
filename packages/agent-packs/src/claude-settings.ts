// Claude Code's project settings for a workspace (ADR-0011): hooks that run snagentic's
// checks around edits (layer 1) and permission rules that keep the agent on snagentic's paths
// (layer 2). Merged into .claude/settings.json by agent install.

const hook = (event: string) => [{ type: "command", command: `snagentic hook claude ${event}` }];
const EDITS = "Edit|Write|MultiEdit|NotebookEdit";
const PROTECTED = [
  ".snagentic/**",
  "**/*.children.*.yaml",
  "instances/*/instance.yaml",
  "snagentic.yaml",
];

export const CLAUDE_SETTINGS = {
  hooks: {
    PreToolUse: [{ matcher: EDITS, hooks: hook("pre-edit") }],
    PostToolUse: [{ matcher: EDITS, hooks: hook("post-edit") }],
    Stop: [{ hooks: hook("stop") }],
  },
  permissions: {
    deny: [
      // The instance is reached only through snagentic, never directly.
      "Bash(curl:*)",
      "Bash(wget:*)",
      "WebFetch(domain:service-now.com)",
      // Git hooks run validate; skipping them skips the checks.
      "Bash(git commit --no-verify:*)",
      "Bash(git push --no-verify:*)",
      ...PROTECTED.flatMap((path) => [`Edit(${path})`, `Write(${path})`]),
    ],
    ask: ["mcp__snagentic__push", "Bash(snagentic push:*)"],
  },
} as const;
