// Runs the architecture rules (ADR-0001) and fails when nothing was analysed, so a parser
// problem (for example an unsupported TypeScript version) can never look like a clean pass.
import { cruise, type IConfiguration, type IViolation } from "dependency-cruiser";
import config from "../.dependency-cruiser.cjs";

export interface ArchReport {
  readonly modulesCruised: number;
  readonly violations: readonly IViolation[];
}

export async function checkArchitecture(paths: readonly string[]): Promise<ArchReport> {
  const rules: IConfiguration = config;
  const result = await cruise([...paths], {
    ...rules.options,
    validate: true,
    ruleSet: { forbidden: rules.forbidden ?? [] },
  });
  if (typeof result.output === "string") {
    throw new Error("expected a structured dependency-cruiser result");
  }
  return {
    modulesCruised: result.output.summary.totalCruised,
    violations: result.output.summary.violations,
  };
}

if (import.meta.main) {
  const report = await checkArchitecture(["packages"]);
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
  console.log(`architecture rules: ${report.modulesCruised} modules, no violations`);
}
