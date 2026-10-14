import type { ScriptKind } from "../advice/index";
import type { FluentBuild, FluentProject } from "./domain/fluent-findings";

// A record as it is in the workspace or at a commit: its fields (scripts included) and the
// files they are in.
export interface RecordVersion {
  readonly className: string;
  readonly scope: string;
  readonly fields: Readonly<Record<string, string>>;
  // Each script field's file, relative to instances/<name>/metadata.
  readonly files: Readonly<Record<string, string>>;
}

// The records of one instance's mirror, as changed in the workspace.
export interface ChangedRecords {
  // The commit `ref` names, or null when it names none.
  resolve(ref: string): Promise<string | null>;
  // Records with a file that differs from `commit`: committed since, edited or added.
  changedSince(commit: string): Promise<string[]>;
  // The record now, or null when it was deleted.
  current(base: string): Promise<RecordVersion | null>;
  // The record at a commit, or null when it did not exist then.
  at(commit: string, base: string): Promise<RecordVersion | null>;
  // How many records of `className` have `field` set to `sysId`: in the workspace, or at
  // `commit` when one is given.
  countReferences(
    className: string,
    field: string,
    sysId: string,
    commit: string | null,
  ): Promise<number>;
  // The cross-scope privileges an application declares in the workspace, as
  // "<target type>:<target name>" (for example "sys_db_object:sys_user").
  privileges(scope: string): Promise<readonly string[]>;
  // The instance's commit while integrate merges it (a merge of the instance's
  // servicenow-remote branch is in progress), or null.
  mirrorMerge(): Promise<string | null>;
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
  sdkVersion(): Promise<string>;
}
