import { protectedReason } from "../../workspace/domain/protected-paths";
import type { Finding } from "../domain/findings";
import { type ValidateDependencies, validate } from "./validate";

export interface CheckQuery {
  // Files, relative to the workspace root.
  readonly paths: readonly string[];
  // instances/<name>/metadata: only files under it are records to validate.
  readonly metadataRoot: string;
  // False before an edit: only whether the files may be edited at all.
  readonly validate: boolean;
}

export interface CheckResult {
  readonly protected: readonly { readonly path: string; readonly reason: string }[];
  readonly findings: readonly Finding[];
  // Nothing protected touched, and no block finding.
  readonly passed: boolean;
}

// The fast check hosts run around each edit (ADR-0011, layer 1): may these files be edited,
// and what did the edit introduce.
export async function checkFiles(
  deps: ValidateDependencies,
  query: CheckQuery,
): Promise<CheckResult> {
  const protectedFiles = query.paths.flatMap((path) => {
    const reason = protectedReason(path);
    return reason === null ? [] : [{ path, reason }];
  });
  const prefix = `${query.metadataRoot}/`;
  const records = query.paths
    .filter((path) => path.startsWith(prefix) && protectedReason(path) === null)
    .map((path) => path.slice(prefix.length));
  const findings =
    query.validate && records.length > 0
      ? (await validate(deps, { base: "HEAD", paths: records })).findings
      : [];
  return {
    protected: protectedFiles,
    findings,
    passed:
      protectedFiles.length === 0 && findings.every((finding) => finding.severity !== "block"),
  };
}
