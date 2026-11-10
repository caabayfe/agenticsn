import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Row } from "@snagentic/core";
import { parse } from "yaml";
import { runGit, runGitOrThrow } from "../../src/adapters/git/run-git";
import { executeUseCase } from "../../src/registry/execute";
import { pull } from "../../src/registry/pull";
import { TEAM_TIMEOUT, team } from "../support/team-workspace";

setDefaultTimeout(TEAM_TIMEOUT);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

interface Step {
  readonly uses?: string;
  readonly name?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

const TEMPLATE = join(import.meta.dir, "../../../../packaging/ci/github/snagentic-pull.yml");
const workflow = parse(readFileSync(TEMPLATE, "utf8")) as {
  jobs: Record<string, { steps: Step[] }>;
};
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
// The template names its instance `dev`; this team's is `pdi`.
const forPdi = (text: string) =>
  text.replaceAll("servicenow-remote/dev", "servicenow-remote/pdi").replaceAll("/dev/", "/pdi/");
const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with ?? {};
const fetchStep = forPdi(steps.find((step) => step.name === "fetch the mirror branch")?.run ?? "");
const patterns = forPdi(String(checkout["sparse-checkout"] ?? ""))
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "");

const RULE = "00000000000000000000000000000001";
const DATA: Record<string, Row[]> = {
  sys_db_object: [
    { sys_id: "c0", name: "sys_metadata", super_class: "" },
    { sys_id: "c1", name: "sys_script", super_class: "c0" },
  ],
  sys_scope: [{ sys_id: "global", scope: "global" }],
  sys_dictionary: [
    { sys_id: "d1", name: "sys_script", element: "script", internal_type: "script_server" },
  ],
  sys_script: [
    { sys_id: RULE, sys_class_name: "sys_script", name: "R", script: "a();", sys_scope: "global" },
  ],
};

// What actions/checkout does with the template's inputs: one commit, blobless, sparse.
async function templateCheckout(origin: string, root: string): Promise<void> {
  expect(checkout["fetch-depth"]).toBe(1);
  expect(checkout["filter"]).toBe("blob:none");
  expect(checkout["sparse-checkout-cone-mode"]).toBe(false);
  const clone = ["clone", "-q", "--filter=blob:none", "--depth", "1", "--no-checkout"];
  await runGitOrThrow([...clone, `file://${origin}`, root], join(origin, ".."));
  await runGitOrThrow(["sparse-checkout", "set", "--no-cone", ...patterns], root);
  await runGitOrThrow(["checkout", "-q", "main"], root);
}

// Spec 014, PERF2-04: the scheduled job checked out the whole default branch (the integrated
// mirror) on every run. These run the template's own checkout and fetch, then the pull.
describe.skipIf(process.platform === "win32")("the CI template's checkout", () => {
  it("holds everything the pull reads: it pulls and publishes from a sparse, blobless clone", async () => {
    const t = await team(DATA);
    cleanups.push(t.cleanup);
    await runGitOrThrow(["config", "uploadpack.allowFilter", "true"], t.origin);
    const first = await t.member();
    await executeUseCase(
      pull,
      { instance: "pdi", publish: true },
      first.at("2026-10-05T12:00:00Z"),
    );
    const rule = t.instance.tables["sys_script"]?.[0];
    Object.assign(rule ?? {}, { script: "b();", sys_updated_on: "2026-10-05 12:10:00" });

    const ci = await t.member("svc_ci", "clone", templateCheckout);
    expect(existsSync(join(ci.root, "instances/pdi/instance.yaml"))).toBe(true);
    expect(existsSync(join(ci.root, "instances/pdi/metadata"))).toBe(false);
    const script = Bun.spawn(["sh", "-e", "-c", fetchStep], {
      cwd: ci.root,
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await script.exited).toBe(0);
    // The mirror's last commit arrived whole: the pull reads its files without a fetch each.
    const tip = "refs/remotes/origin/servicenow-remote/pdi";
    const objects = await runGit(["rev-list", "--objects", "--missing=print", tip], ci.root);
    expect(objects.exitCode).toBe(0);
    expect(objects.stdout.split("\n").filter((line) => line.startsWith("?"))).toEqual([]);

    const run = await executeUseCase(
      pull,
      { instance: "pdi", now: true, publish: true },
      ci.at("2026-10-05T12:15:00Z"),
    );
    expect(run.output).toMatchObject({ mode: "incremental", changed: true });
    expect(run.output["shared"]).toMatchObject({ from: "shared", published: true });
  });
});
