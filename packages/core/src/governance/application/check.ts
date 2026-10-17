import { protectedReason } from "../../workspace/domain/protected-paths";

export interface CheckQuery {
  // Files, relative to the workspace root.
  readonly paths: readonly string[];
}

export interface CheckResult {
  readonly protected: readonly { readonly path: string; readonly reason: string }[];
  // Nothing protected touched.
  readonly passed: boolean;
}

// The fast check hosts run around each edit (ADR-0011, layer 1; ASR-04): may these files be
// edited at all. What an edit to Fluent source introduces needs a build, which validate runs
// before the agent stops and before every commit (ADR-0031 item 6).
export function checkFiles(query: CheckQuery): CheckResult {
  const protectedFiles = query.paths.flatMap((path) => {
    const reason = protectedReason(path);
    return reason === null ? [] : [{ path, reason }];
  });
  return { protected: protectedFiles, passed: protectedFiles.length === 0 };
}
