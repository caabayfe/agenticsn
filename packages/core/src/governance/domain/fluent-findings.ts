// A Fluent project in the workspace (ADR-0028 as amended): a folder under source/ with a
// now.config.json.
export interface FluentProject {
  // Relative to the workspace, with "/": source/<scope>.
  readonly path: string;
  // The @servicenow/sdk version its package.json names, or null when it names none.
  readonly declaredSdk: string | null;
}

export interface FluentBuildError {
  // Relative to the project, with "/".
  readonly file: string;
  readonly line: number;
  readonly column: number;
  // The SDK's code: ts<number> (TypeScript) or fluent<number>.
  readonly code: string;
  readonly message: string;
}

export type FluentBuild =
  | {
      readonly built: true;
      // When the build changes src/fluent/generated/keys.ts (new IDs not committed yet): the
      // project's keys.ts (null when it has none) and the one the build wrote.
      readonly keys: { readonly committed: string | null; readonly built: string } | null;
      // Update names of the records the build would delete.
      readonly deletes: readonly string[];
    }
  | { readonly built: false; readonly errors: readonly FluentBuildError[] };

export const KEYS_FILE = "src/fluent/generated/keys.ts";

// A Fluent rule's hit; the application adds the rule's title, why and remediation.
export interface FluentHit {
  readonly ruleId: string;
  // Relative to the workspace.
  readonly path: string;
  readonly line: number | null;
  readonly message: string;
  readonly evidence: string;
}

function finding(
  ruleId: string,
  path: string,
  line: number | null,
  message: string,
  evidence = "",
): FluentHit {
  return { ruleId, path, line, message, evidence };
}

// What one Fluent project's build says about the change (ADR-0028 as amended, items 4 and 5).
export function fluentFindings(
  project: FluentProject,
  build: FluentBuild,
  sdkVersion: string,
): FluentHit[] {
  const findings: FluentHit[] = [];
  if (project.declaredSdk !== null && project.declaredSdk !== sdkVersion) {
    findings.push(
      finding(
        "SN-UPG-003",
        `${project.path}/package.json`,
        null,
        `the project names @servicenow/sdk ${project.declaredSdk}; snagentic builds with ${sdkVersion}`,
      ),
    );
  }
  if (!build.built) {
    for (const error of build.errors) {
      findings.push(
        finding(
          "SN-MNT-009",
          `${project.path}/${error.file}`,
          error.line,
          `${error.code}: ${error.message}`,
          `column ${error.column}`,
        ),
      );
    }
    return findings;
  }
  if (build.keys !== null) {
    findings.push(
      finding(
        "SN-MNT-010",
        `${project.path}/${KEYS_FILE}`,
        null,
        "the build adds IDs that keys.ts does not hold yet",
      ),
    );
  }
  for (const name of build.deletes) {
    findings.push(
      finding("SN-MNT-011", `${project.path}/${KEYS_FILE}`, null, `the build deletes ${name}`),
    );
  }
  return findings;
}
