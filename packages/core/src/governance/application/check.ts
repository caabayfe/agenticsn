import { baseOfFile } from "../../knowledge/index";
import { protectedReason } from "../../workspace/domain/protected-paths";
import type { Finding } from "../domain/findings";
import { type ValidateDependencies, validate } from "./validate";

export interface CheckQuery {
  // Files, relative to the workspace root.
  readonly paths: readonly string[];
  // False before an edit: only whether the files may be edited at all.
  readonly validate: boolean;
  // Only this instance's records are validated; by default, each record's own instance.
  readonly instance?: string;
}

export interface CheckResult {
  readonly protected: readonly { readonly path: string; readonly reason: string }[];
  // After an edit: record files that do not exist (deleted, or a wrong path). Nothing could be
  // checked for them, which must not read as a pass.
  readonly missing: readonly string[];
  readonly findings: readonly Finding[];
  // Nothing protected touched, nothing missing, and no block finding.
  readonly passed: boolean;
}

// The fast check hosts run around each edit (ADR-0011, layer 1): may these files be edited,
// and what did the edit introduce.
// Records are files under instances/<name>/metadata; the hosts' hooks name files, not
// instances, so protection must not depend on knowing one.
const RECORD = /^instances\/([^/]+)\/metadata\/(.+)$/;

function recordsByInstance(query: CheckQuery): Map<string, string[]> {
  const byInstance = new Map<string, string[]>();
  for (const path of query.paths) {
    const match = RECORD.exec(path);
    const [instance, record] = [match?.[1], match?.[2]];
    if (instance === undefined || record === undefined || protectedReason(path) !== null) {
      continue;
    }
    if (query.instance === undefined || query.instance === instance) {
      byInstance.set(instance, [...(byInstance.get(instance) ?? []), record]);
    }
  }
  return byInstance;
}

export async function checkFiles(
  depsFor: (instance: string) => ValidateDependencies,
  query: CheckQuery,
): Promise<CheckResult> {
  const protectedFiles = query.paths.flatMap((path) => {
    const reason = protectedReason(path);
    return reason === null ? [] : [{ path, reason }];
  });
  const findings: Finding[] = [];
  const missing: string[] = [];
  if (query.validate) {
    for (const [instance, paths] of recordsByInstance(query)) {
      const deps = depsFor(instance);
      for (const path of paths) {
        if ((await deps.records.current(baseOfFile(path))) === null) {
          missing.push(`instances/${instance}/metadata/${path}`);
        }
      }
      findings.push(...(await validate(deps, { base: "HEAD", paths })).findings);
    }
  }
  return {
    protected: protectedFiles,
    missing,
    findings,
    passed:
      protectedFiles.length === 0 &&
      missing.length === 0 &&
      findings.every((finding) => finding.severity !== "block"),
  };
}
