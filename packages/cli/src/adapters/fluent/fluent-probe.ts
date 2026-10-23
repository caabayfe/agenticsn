import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { EnvironmentProbe } from "@snagentic/core";
import { failedCheck, okCheck } from "../check-results";
import { PROBE_FILES, PROBE_KEYS_FILE, PROBE_RECORD } from "./fluent-probe-project";
import { type LoadFluentRuntime, loadFluentRuntime } from "./fluent-runtime-loader";
import type { FluentBuildOutcome } from "./sdk-runtime";

const NAME = "fluent";
const HINT = "the embedded ServiceNow SDK cannot build flows: reinstall snagentic, then report it";

function writeProject(root: string): void {
  for (const [path, text] of PROBE_FILES) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

// What is wrong with the build, or null when it is the one expected record with keys unchanged.
function problem(outcome: FluentBuildOutcome, root: string): string | null {
  if (!outcome.success) {
    const first = outcome.errors[0];
    return first ? `build failed: ${first.code} ${first.message}` : "build failed";
  }
  if (outcome.records.length !== 1 || outcome.records[0] !== PROBE_RECORD) {
    return `built ${outcome.records.length} records instead of the test flow`;
  }
  if (readFileSync(join(root, PROBE_KEYS_FILE), "utf8") !== PROBE_FILES.get(PROBE_KEYS_FILE)) {
    return "the build changed the project's keys";
  }
  return null;
}

// How the build was contained (ADR-0044): every build runs in a worker with no credential; the
// sandbox, where there is one, also keeps it off the network and out of other folders.
function contained(isolation: string | undefined): string {
  if (isolation === undefined) return "";
  return isolation === "none"
    ? ", in a worker with no credential (no sandbox on this system)"
    : `, in a worker with no credential, sandboxed by ${isolation}`;
}

// Builds a one-flow Fluent project with the embedded SDK in a temporary folder (ADR-0028).
export function fluentProbe(
  load: LoadFluentRuntime = loadFluentRuntime,
  temporaryRoot: string = tmpdir(),
): EnvironmentProbe {
  return {
    name: NAME,
    async run() {
      const root = mkdtempSync(join(temporaryRoot, "snagentic-fluent-"));
      try {
        const started = performance.now();
        const runtime = await load();
        writeProject(root);
        const found = problem(await runtime.build(root), root);
        const ms = Math.round(performance.now() - started);
        return found === null
          ? okCheck(
              NAME,
              `ServiceNow SDK ${runtime.sdkVersion}: built a test flow in ${ms} ms${contained(runtime.isolation?.())}`,
            )
          : failedCheck(NAME, `ServiceNow SDK ${runtime.sdkVersion}: ${found}`, HINT);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return failedCheck(NAME, detail, HINT);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}
