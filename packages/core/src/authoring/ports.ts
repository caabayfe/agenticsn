import type { Ledger } from "./domain/ledger";
import type { BuiltUnit } from "./domain/unit";

// The workspace's Fluent projects (ADR-0031): source/<scope>/, one per scope.
export interface SourceProject {
  // Workspace-relative: source/<scope>.
  readonly path: string;
  readonly scope: string;
  readonly scopeId: string;
}

export interface AuthoringWorkspace {
  project(scope: string): Promise<SourceProject | null>;
  // Creates source/<scope>/ as a `configuration` project for the embedded SDK.
  scaffold(scope: { readonly name: string; readonly sysId: string }): Promise<SourceProject>;
  readLedger(project: SourceProject): Promise<Ledger>;
  writeLedger(project: SourceProject, ledger: Ledger): Promise<void>;
}

// How the embedded SDK reaches the instance: snagentic's client, checked and scheduled
// (ADR-0032).
export interface SdkAccess {
  readonly host: string;
  readonly exchange: (request: {
    readonly method: "GET" | "POST";
    readonly url: string;
    readonly body?: string;
  }) => Promise<{ readonly status: number; readonly contentType: string; readonly text: string }>;
}

export interface TransformTarget {
  readonly table: string;
  readonly sysId: string;
}

// A transform made in a copy of a project: nothing reaches the workspace until `apply`.
export interface SourceDraft {
  // The project's units built before and after the transform.
  readonly before: readonly BuiltUnit[];
  readonly after: readonly BuiltUnit[];
  // Project-relative source files the transform wrote.
  readonly changed: readonly string[];
  // Copies the changed files into the workspace's project.
  apply(): Promise<void>;
}

export type DraftOutcome =
  | { readonly ok: true; readonly draft: SourceDraft }
  | { readonly ok: false; readonly message: string };

export interface FluentToolchain {
  // In a copy of the project as the working tree holds it: build, transform the records from
  // the instance, build again.
  draftTransform(
    project: SourceProject,
    records: readonly TransformTarget[],
    access: SdkAccess,
  ): Promise<DraftOutcome>;
}
