import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { optionsFor } from "../../packages/cli/src/cli/zod-options";
import { USE_CASES } from "../../packages/cli/src/registry/registry";
import { qualifiedName } from "../../packages/cli/src/registry/use-case";

// The CI templates teams copy (ADR-0004, spec 014 T2). They are checked against the code, so a
// renamed command or flag, an unpinned action or a stale version fails here, not in a team's CI.
const ROOT = join(import.meta.dir, "../..");
const TEMPLATES = join(ROOT, "packaging/ci/github");
const GLOBAL_FLAGS = ["--format", "--workspace"];
const VERSION: string = JSON.parse(
  readFileSync(join(ROOT, "packages/cli/package.json"), "utf8"),
).version;

interface Step {
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
}
interface Job {
  readonly permissions?: Record<string, string>;
  readonly env?: Record<string, string>;
  readonly steps: readonly Step[];
}
interface Workflow {
  readonly on: { readonly schedule?: readonly { readonly cron: string }[] };
  readonly permissions?: Record<string, string>;
  readonly concurrency?: { readonly group?: string };
  readonly jobs: Record<string, Job>;
}

const templates = readdirSync(TEMPLATES).filter((file) => file.endsWith(".yml"));
const read = (file: string) => readFileSync(join(TEMPLATES, file), "utf8");
const steps = (workflow: Workflow) => Object.values(workflow.jobs).flatMap((job) => job.steps);

// The snagentic command lines of a run script, as words.
function snagenticCommands(workflow: Workflow): string[][] {
  return steps(workflow)
    .flatMap((step) => (step.run ?? "").split("\n"))
    .map((line) => line.trim().split(/\s+/))
    .filter((words) => words[0] === "snagentic");
}

// The use case a command line names, the longest qualified name first ("update-sets list").
function useCaseFor(words: readonly string[]) {
  const commands = USE_CASES.filter((useCase) => useCase.cli !== false);
  const matches = commands.filter((useCase) => {
    const name = qualifiedName(useCase).split(" ");
    return name.every((part, index) => words[index + 1] === part);
  });
  return matches.sort((a, b) => qualifiedName(b).length - qualifiedName(a).length)[0];
}

describe("CI templates (spec 014, T2)", () => {
  it("ships the GitHub Actions scheduled pull", () => {
    expect(templates).toContain("snagentic-pull.yml");
  });

  for (const file of templates) {
    const text = read(file);
    const workflow = parse(text) as Workflow;

    it(`${file} is a workflow with jobs and steps`, () => {
      expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0);
      for (const job of Object.values(workflow.jobs)) {
        expect(job.steps.length).toBeGreaterThan(0);
      }
    });

    it(`${file} pins every action by commit SHA`, () => {
      const uses = steps(workflow).flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
      expect(uses.length).toBeGreaterThan(0);
      for (const action of uses) {
        expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    });

    it(`${file} runs only commands and flags the registry has`, () => {
      const commands = snagenticCommands(workflow);
      expect(commands.length).toBeGreaterThan(0);
      for (const words of commands) {
        const useCase = useCaseFor(words);
        expect(useCase, words.join(" ")).toBeDefined();
        if (useCase === undefined) continue;
        const known = optionsFor(useCase.input, useCase.arguments ?? []).map((o) => o.long);
        for (const flag of words.filter((word) => word.startsWith("--"))) {
          expect([...known, ...GLOBAL_FLAGS], `${words.join(" ")}: ${flag}`).toContain(flag);
        }
      }
    });

    it(`${file} grants nothing by default and contents: write only to the job that publishes`, () => {
      expect(workflow.permissions).toEqual({});
      for (const job of Object.values(workflow.jobs)) {
        const publishes = job.steps.some((step) => (step.run ?? "").includes("--publish"));
        const write = Object.entries(job.permissions ?? {}).filter(
          ([, level]) => level === "write",
        );
        expect(write).toEqual(publishes ? [["contents", "write"]] : []);
      }
    });

    it(`${file} runs one pull of an instance at a time, on the default max age`, () => {
      expect(workflow.concurrency?.group).toMatch(/^snagentic-pull-[a-z0-9-]+$/);
      expect(workflow.on.schedule?.map((entry) => entry.cron)).toEqual(["*/15 * * * *"]);
    });

    it(`${file} installs the release it ships with, and requires its provenance`, () => {
      const install = steps(workflow).find((step) => step.env?.["SNAGENTIC_VERSION"] !== undefined);
      expect(install?.env?.["SNAGENTIC_VERSION"]).toBe(VERSION);
      expect(install?.env?.["GH_TOKEN"]).toBeDefined();
      expect(install?.run).toContain("/install.sh");
      expect(install?.run).toContain('grep -q "provenance verified"');
    });

    it(`${file} takes the secret from secrets and pins it with the url and kind (ADR-0020)`, () => {
      const env = Object.values(workflow.jobs).find((job) => job.env !== undefined)?.env ?? {};
      const password = Object.keys(env).find((name) => /^SNAGENTIC_\w+_PASSWORD$/.test(name));
      expect(password).toBeDefined();
      const prefix = (password ?? "").replace(/_PASSWORD$/, "");
      expect(env[`${prefix}_PASSWORD`]).toMatch(/^\$\{\{ secrets\.\w+ \}\}$/);
      expect(env[`${prefix}_URL`]).toBeDefined();
      expect(env[`${prefix}_KIND`]).toMatch(/^(development|test|production)$/);
      const secretLike = [...text.matchAll(/^\s*([\w-]*(?:PASSWORD|SECRET|KEY|key)):\s*(.+)$/gm)];
      for (const [, name, value] of secretLike) {
        expect(value, name).toMatch(/^\$\{\{ secrets\.\w+ \}\}$/);
      }
    });
  }
});
