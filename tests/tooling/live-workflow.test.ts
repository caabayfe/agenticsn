import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { LIVE_INSTANCE, REQUIRED_SETTINGS } from "../../scripts/live-preflight";

// The nightly live run (spec 016, T1) holds the credential of a development instance and writes
// to it. These pin what keeps that credential away from code nobody reviewed.
const ROOT = join(import.meta.dir, "../..");
const TEXT = readFileSync(join(ROOT, ".github/workflows/live.yml"), "utf8");

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, string | boolean>;
}
interface Job {
  readonly if?: string;
  readonly environment?: string;
  readonly permissions?: Record<string, string>;
  readonly env?: Record<string, string>;
  readonly "timeout-minutes"?: number;
  readonly steps: readonly Step[];
}
interface Workflow {
  readonly on: Record<string, unknown>;
  readonly permissions?: Record<string, string>;
  readonly env?: Record<string, string>;
  readonly concurrency?: { readonly group?: string; readonly "cancel-in-progress"?: boolean };
  readonly jobs: Record<string, Job>;
}

const workflow = parse(TEXT) as Workflow;
const jobs = Object.values(workflow.jobs);
const steps = jobs.flatMap((job) => job.steps);
const withSecrets = steps.filter((step) => JSON.stringify(step.env ?? {}).includes("secrets."));

describe("the nightly live run (spec 016, T1)", () => {
  it("starts on a schedule or by hand, never from a pull request", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(TEXT).not.toContain("pull_request");
  });

  it("runs only in this repository, on its main branch", () => {
    for (const job of jobs) {
      expect(job.if).toContain("github.repository == 'caabayfe/agenticsn'");
      expect(job.if).toContain("github.ref == 'refs/heads/main'");
    }
  });

  it("takes its credential from the live-pdi environment", () => {
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.environment).toBe("live-pdi");
  });

  it("never runs two writers of the instance at once, and never stops one halfway", () => {
    expect(workflow.concurrency).toEqual({ group: "live-pdi", "cancel-in-progress": false });
  });

  it("grants nothing by default, and the job only reading the code and writing issues", () => {
    expect(workflow.permissions).toEqual({});
    expect(jobs[0]?.permissions).toEqual({ contents: "read", issues: "write" });
  });

  it("gives the credential only to the steps that call the instance", () => {
    expect(workflow.env).toBeUndefined();
    expect(jobs[0]?.env).toBeUndefined();
    expect(withSecrets.map((step) => step.id)).toEqual(["instance", "tests"]);
    for (const step of withSecrets) {
      expect(step.uses).toBeUndefined();
      expect(step.env?.[`SNAGENTIC_${LIVE_INSTANCE.toUpperCase()}_KIND`]).toBe("development");
      for (const name of REQUIRED_SETTINGS) {
        expect(step.env?.[name]).toMatch(new RegExp(`^\\$\\{\\{ (secrets|vars)\\.${name} \\}\\}$`));
      }
    }
  });

  it("names the only secret it reads, besides the workflow's own token", () => {
    const names = [...TEXT.matchAll(/secrets\.([A-Z_]+)/g)].map((match) => match[1]);
    expect([...new Set(names)]).toEqual(["SNAGENTIC_PDI_PASSWORD"]);
  });

  it("does not leave the workflow's token in the checkout", () => {
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

  it("pins every action by commit SHA", () => {
    const uses = steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
  });

  it("never traces its commands", () => {
    expect(TEXT).not.toMatch(/set -[a-z]*x|xtrace|ACTIONS_STEP_DEBUG/);
  });

  it("tests only when the instance answered, and fails when no test ran", () => {
    const tests = steps.find((step) => step.id === "tests");
    expect(tests?.if).toBe("steps.instance.outputs.state == 'ready'");
    expect(tests?.run).toContain("bun test tests/live");
    expect(tests?.env?.["SNAGENTIC_LIVE_INSTANCE"]).toBe(LIVE_INSTANCE);
    expect(tests?.run).toContain("[1-9][0-9]* pass$");
  });

  it("reports a failure in an issue, with the workflow's own token", () => {
    const report = steps.find((step) => (step.run ?? "").includes("gh issue"));
    expect(report?.if).toBe("failure()");
    expect(report?.env?.["GH_TOKEN"]).toMatch(/^\$\{\{ github\.token \}\}$/);
    expect(report?.run).toContain("gh issue comment");
    expect(report?.run).toContain("gh issue create");
  });

  it("has a time limit", () => {
    expect(jobs[0]?.["timeout-minutes"]).toBeLessThanOrEqual(30);
  });
});
