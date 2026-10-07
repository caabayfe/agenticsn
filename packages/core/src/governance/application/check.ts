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
  readonly findings: readonly Finding[];
  // Nothing protected touched, and no block finding.
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
  if (query.validate) {
    for (const [instance, paths] of recordsByInstance(query)) {
      findings.push(...(await validate(depsFor(instance), { base: "HEAD", paths })).findings);
    }
  }
  return {
    protected: protectedFiles,
    findings,
    passed:
      protectedFiles.length === 0 && findings.every((finding) => finding.severity !== "block"),
  };
}
