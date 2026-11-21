// The evaluation harness (spec 003, section 7): real agents run scripted scenarios in a copy
// of a mirrored workspace, and are scored on what they did, not on what they wrote.

// One tool call the agent made, with what it got back.
export interface ToolCall {
  // As the host names it: Read, Edit, Skill, mcp__snagentic__describe, ...
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly result: string;
  readonly isError: boolean;
  // Which user turn it happened in (0-based).
  readonly turn: number;
}

export interface Trace {
  readonly calls: readonly ToolCall[];
  // The agent's last message of each turn.
  readonly replies: readonly string[];
  // Skills the host had discovered at session start.
  readonly skillsAvailable: readonly string[];
  readonly costUsd: number;
  readonly seconds: number;
  readonly model: string;
  readonly error: string | null;
}

// What the agent left in the workspace (relative paths), against the scenario's base.
export interface WorkspaceChanges {
  readonly changed: readonly string[];
  // `snagentic validate` on the end state, run by the harness.
  readonly validatePassed: boolean | null;
}

export interface CheckResult {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface Check {
  readonly id: string;
  readonly describe: string;
  run(trace: Trace, changes: WorkspaceChanges): CheckResult;
}

// What a scenario's fixtures know about the slot they write into.
export interface FixtureContext {
  // The slot's instance (the first under instances/): mirror paths and ledgers name it.
  readonly instance: string;
}

export type Fixture = (workspace: string, context: FixtureContext) => Promise<void>;

export interface Scenario {
  readonly id: string;
  readonly kind: "task" | "trigger";
  // What the user says, one entry per turn.
  readonly turns: readonly string[];
  // Files the workspace holds before the user's work: committed, and the base the run's
  // changes are measured against (an adopted project, a record in the mirror).
  readonly fixture?: Fixture;
  // The user's work in progress, written after the fixture and left uncommitted (for example,
  // a change to review).
  readonly prepare?: Fixture;
  // What the scenario cannot show with the instance unreachable.
  readonly limit?: string;
  readonly checks: readonly Check[];
  // Caps the agent's turns per user message (trigger evaluations stop early).
  readonly maxTurns?: number;
}

export interface Variant {
  readonly id: string;
  readonly describe: string;
  // Replaces the instructions block in AGENTS.md; the installed pack's when absent.
  readonly instructions?: string;
  readonly mcp: boolean;
  readonly skills: boolean;
}

export interface RunResult {
  readonly scenario: string;
  readonly variant: string;
  readonly repetition: number;
  readonly checks: readonly CheckResult[];
  readonly changed: readonly string[];
  readonly costUsd: number;
  readonly seconds: number;
  readonly toolCalls: number;
  readonly model: string;
  readonly error: string | null;
}
