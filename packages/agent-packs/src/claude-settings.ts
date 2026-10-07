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
  "waivers.yaml",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".github/hooks/**",
];

export const CLAUDE_SETTINGS = {
  hooks: {
    PreToolUse: [
      { matcher: EDITS, hooks: hook("pre-edit") },
      // Copilot CLI reads these hooks but not the permission rules below, so the shell
      // rules are enforced here as well.
      { matcher: "Bash", hooks: hook("pre-shell") },
    ],
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
      // Logging in is how a person trusts an instance's url and kind (ADR-0020).
      "Bash(snagentic auth:*)",
      // Claude Code applies Edit rules to every file-writing tool; Write rules are ignored.
      ...PROTECTED.map((path) => `Edit(${path})`),
    ],
    ask: ["mcp__snagentic__push", "Bash(snagentic push:*)"],
  },
} as const;

// Shell commands the pre-shell hook refuses: the same intent as the deny rules above, for
// hosts that run hooks but ignore Claude's permissions. Guidance, not a boundary (ADR-0011):
// the push gate and CI still hold if a command slips through.
const INSTANCE = "reach ServiceNow only through snagentic, which enforces the instance kind";
const GIT_HOOKS = "git hooks run validate; skipping them skips the checks";
const CREDENTIALS = "credentials and the instance they are for are set by a person (ADR-0020)";
export const SHELL_DENY: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /(?:^|[\s;&|(`])(?:curl|wget)(?=\s|$)/, reason: INSTANCE },
  { pattern: /service-now\.com/i, reason: INSTANCE },
  { pattern: /--no-verify\b|core\.hooksPath/, reason: GIT_HOOKS },
  { pattern: /\bcommit\b[^;&|]*\s-[a-zA-Z]*n[a-zA-Z]*(?=\s|$)/, reason: GIT_HOOKS },
  { pattern: /\bsnagentic\s+auth\b/, reason: CREDENTIALS },
  { pattern: /\bSNAGENTIC_\w+_(?:PASSWORD|URL|KIND)\s*=/, reason: CREDENTIALS },
];
