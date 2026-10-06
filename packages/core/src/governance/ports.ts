import type { ScriptKind } from "../advice/index";

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
}

// What a rule pack needs to know about the record a script belongs to.
export interface ScriptContext {
  readonly className: string;
  readonly kind: ScriptKind;
  readonly scoped: boolean;
  readonly when: string;
  readonly type: string;
  readonly name: string;
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
