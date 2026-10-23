// One reason a Fluent project did not build: the SDK's diagnostics, or snagentic's refusals.
export interface FluentBuildError {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}
