// What the nightly live run (spec 016, T1; .github/workflows/live.yml) decides before it tests:
// whether its environment is set up, and what the instance answered to one signed-in read. A
// developer instance hibernates when idle, so "asleep" ends the run without testing and without
// failing; a refused sign-in is a failure someone must act on.
import type { InstanceAnswer } from "../packages/core/src/index";

// The instance's name in the run's workspace: it names the variables the product reads.
export const LIVE_INSTANCE = "pdi";
export const LIVE_ENVIRONMENT = "live-pdi";
export const REQUIRED_SETTINGS = [
  "SNAGENTIC_PDI_URL",
  "SNAGENTIC_PDI_USERNAME",
  "SNAGENTIC_PDI_PASSWORD",
] as const;

export interface Preflight {
  readonly state: "ready" | "not-configured" | "asleep" | "failed";
  readonly title: string;
  readonly message: string;
}

// GitHub passes a secret or variable nobody created as empty text.
export function missingSettings(environment: Readonly<Record<string, string | undefined>>) {
  return REQUIRED_SETTINGS.filter((name) => (environment[name] ?? "") === "");
}

export function notConfigured(missing: readonly string[]): Preflight {
  return {
    state: "not-configured",
    title: "Live run not configured, nothing tested",
    message:
      `the GitHub environment ${LIVE_ENVIRONMENT} lacks ${missing.join(", ")}. ` +
      "Create it as docs/guides/live-tests.md says",
  };
}

export function preflightOf(answer: InstanceAnswer): Preflight {
  if (answer.outcome === "ready") {
    return { state: "ready", title: "Instance ready", message: "the instance answered" };
  }
  const message = `${answer.message}. ${answer.hint}`;
  return answer.outcome === "asleep" || answer.outcome === "unreachable"
    ? { state: "asleep", title: "Instance asleep, nothing tested", message }
    : { state: "failed", title: "Instance refused the live run", message };
}

export interface GithubReport {
  // A line for $GITHUB_OUTPUT.
  readonly output: string;
  // A workflow command for the log, shown on the run's page; none when there is nothing to say.
  readonly annotation: string | null;
  // Markdown for $GITHUB_STEP_SUMMARY.
  readonly summary: string;
}

// A workflow command is one line, and `::` inside its title would end the title early.
const oneLine = (text: string) => text.replaceAll(/[\r\n]+/g, " ");

export function githubReport(preflight: Preflight): GithubReport {
  const level = preflight.state === "failed" ? "error" : "notice";
  const title = oneLine(preflight.title).replaceAll("::", ":");
  return {
    output: `state=${preflight.state}\n`,
    annotation:
      preflight.state === "ready"
        ? null
        : `::${level} title=${title}::${oneLine(preflight.message)}`,
    summary: `### ${preflight.title}\n\n${preflight.message}\n`,
  };
}
