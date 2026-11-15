// Presentation only (ADR-0003): schemas and handlers remain shared by CLI, MCP and hooks.
export const HELP_SECTIONS = [
  "Get started",
  "Understand",
  "Develop",
  "Manage",
  "Additional workflows",
  "Advanced",
  "Internal",
] as const;

export interface UseCaseHelp {
  readonly summary: string;
  readonly section: (typeof HELP_SECTIONS)[number];
  readonly visibility?: "standard" | "advanced" | "internal";
  readonly order?: number;
  readonly group?: string;
  readonly details: string;
  readonly effects: string;
  // Tokens, so examples can be checked against the parser without executing a shell.
  readonly examples: readonly (readonly string[])[];
  // Human CLI wording where the schema's model-facing description is unsuitable.
  readonly options?: Readonly<Record<string, string>>;
}

export const HELP_GROUPS = {
  instance: "Manage instance profiles",
  auth: "Sign in or remove stored credentials",
  agent: "Install coding-agent instructions, skills and hooks",
  updateSets: "Inspect collisions and export update sets",
  accelerator: "Inspect and install reusable capability packs",
  docs: "Maintain documentation backed by instance evidence",
  plugins: "Inspect plugins and activate development prerequisites",
  apps: "Install store applications on development",
} as const;
