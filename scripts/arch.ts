// Runs the architecture rules (ADR-0001) and fails when nothing was analysed, so a parser
// problem (for example an unsupported TypeScript version) can never look like a clean pass.
// Violations recorded in the baseline (dependency-cruiser's known violations) are reported
// as known, not as failures: only new ones fail. tests/architecture keeps the baseline from
// growing.
import { cruise, type IConfiguration, type IViolation } from "dependency-cruiser";
import config from "../.dependency-cruiser.cjs";

export const BASELINE_FILE = ".dependency-cruiser-known-violations.json";

export interface ArchReport {
  readonly modulesCruised: number;
  readonly violations: readonly IViolation[];
  readonly known: number;
}

export async function readBaseline(path = BASELINE_FILE): Promise<IViolation[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return [];
  }
  const parsed: unknown = await file.json();
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must hold an array of violations`);
  }
  return parsed;
}

export async function checkArchitecture(
  paths: readonly string[],
  knownViolations: readonly IViolation[] = [],
): Promise<ArchReport> {
  const rules: IConfiguration = config;
  const result = await cruise([...paths], {
    ...rules.options,
    validate: true,
    ruleSet: { forbidden: rules.forbidden ?? [] },
    knownViolations: [...knownViolations],
  });
  if (typeof result.output === "string") {
    throw new Error("expected a structured dependency-cruiser result");
  }
  const all = result.output.summary.violations;
  const violations = all.filter((violation) => violation.rule.severity !== "ignore");
  return {
    modulesCruised: result.output.summary.totalCruised,
    violations,
    known: all.length - violations.length,
  };
}

if (import.meta.main) {
  const report = await checkArchitecture(["packages"], await readBaseline());
  for (const violation of report.violations) {
    console.error(`${violation.rule.name}: ${violation.from} -> ${violation.to}`);
  }
  if (report.modulesCruised === 0) {
    console.error("architecture check analysed 0 modules: the TypeScript parser is unavailable");
    process.exit(1);
  }
  if (report.violations.length > 0) {
    console.error(`${report.violations.length} architecture violation(s)`);
    process.exit(1);
  }
  console.log(
    `architecture rules: ${report.modulesCruised} modules, no new violations ` +
      `(${report.known} known, recorded in ${BASELINE_FILE})`,
  );
}
