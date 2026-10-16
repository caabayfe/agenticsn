import type { ScriptKind } from "../advice/index";
import type { FluentBuild, FluentProject } from "./domain/fluent-findings";

// A record as validate checks it: a built unit's head (ADR-0031), its fields (scripts
// included) and the source file each script is in.
export interface RecordVersion {
  readonly className: string;
  readonly scope: string;
  readonly fields: Readonly<Record<string, string>>;
  // Each script field's file, relative to the workspace.
  readonly files: Readonly<Record<string, string>>;
}

// The instance's mirror as validate sees it: read-only, written only by pull (ADR-0031 item 2).
export interface MirrorState {
  // The commit `ref` names, or null when it names none.
  resolve(ref: string): Promise<string | null>;
  // Mirror files the workspace changed (edited, added or deleted), compared with the instance's
  // copy the branch last integrated, or the one an integrate is merging. Workspace-relative.
  edited(): Promise<readonly string[]>;
  // The cross-scope privileges an application declares on the instance, as
  // "<target type>:<target name>" (for example "sys_db_object:sys_user").
  privileges(scope: string): Promise<readonly string[]>;
}

// What a rule pack needs to know about the record a script belongs to.
export interface ScriptContext {
  readonly className: string;
  readonly kind: ScriptKind;
  readonly scoped: boolean;
  readonly when: string;
  readonly type: string;
  readonly name: string;
  readonly scope: string;
  // What the record's application declares it may reach in other scopes; empty in global.
  readonly privileges: readonly string[];
}

export interface ScriptHit {
  readonly ruleId: string;
  readonly line: number;
  readonly message: string;
}

export type ScriptCheckResult =
  | { readonly parsed: true; readonly hits: readonly ScriptHit[] }
  | { readonly parsed: false; readonly line: number; readonly message: string };

// Runs a rule pack's script rules (packages/rules-basic) on one script.
export interface ScriptChecker {
  check(source: string, ruleIds: readonly string[], context: ScriptContext): ScriptCheckResult;
}

// The workspace's Fluent projects and the embedded SDK that builds them.
export interface FluentProjects {
  // Projects with a file that differs from `commit`: committed since, edited or added.
  changedSince(commit: string): Promise<readonly FluentProject[]>;
  // Projects holding any of these workspace-relative paths.
  holding(paths: readonly string[]): Promise<readonly FluentProject[]>;
  // Builds a copy of the project; the workspace is never written.
  build(project: FluentProject): Promise<FluentBuild>;
  // The project as `commit` held it, built; null when it did not exist then.
  buildAt(project: FluentProject, commit: string): Promise<FluentBuild | null>;
  // Writes a build's keys.ts into the project (and stages it, when the projects are the
  // index's); the only write to Fluent source snagentic makes.
  writeKeys(project: FluentProject, keys: string): Promise<void>;
  sdkVersion(): Promise<string>;
}
