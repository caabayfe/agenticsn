import { type Check, type DoctorReport, summarizeChecks } from "../domain/check";
import type { EnvironmentProbe } from "../ports";

async function runProbe(probe: EnvironmentProbe): Promise<Check> {
  try {
    return await probe.run();
  } catch (error) {
    return {
      name: probe.name,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      hint: "the check itself failed unexpectedly; please report this",
    };
  }
}

export async function runDoctor(probes: readonly EnvironmentProbe[]): Promise<DoctorReport> {
  return summarizeChecks(await Promise.all(probes.map(runProbe)));
}
