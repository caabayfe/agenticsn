import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import type { Row } from "@snagentic/core";
import { runGit } from "../../src/adapters/git/run-git";
import { executeUseCase } from "../../src/registry/execute";
import { integrate } from "../../src/registry/integrate";
import { pull } from "../../src/registry/pull";
import { TEAM_TIMEOUT, team } from "../support/team-workspace";

setDefaultTimeout(TEAM_TIMEOUT);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const DATA: Record<string, Row[]> = {
  sys_db_object: [{ sys_id: "c0", name: "sys_metadata", super_class: "" }],
  sys_scope: [{ sys_id: "global", scope: "global" }],
  sys_dictionary: [],
};

async function local(root: string, key: string): Promise<string | null> {
  const result = await runGit(["config", "--local", "--get", key], root);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

// Spec 014, PERF2-04: only init tuned git, so a teammate's clone and the CI runner had none of it.
describe("a plain clone of a workspace gets the large-repository tuning", () => {
  it("from integrate and pull, in the clone's own config, keeping what the person set", async () => {
    const t = await team(DATA);
    cleanups.push(t.cleanup);
    const ci = await t.member();
    await executeUseCase(pull, { instance: "pdi", publish: true }, ci.at("2026-10-05T12:00:00Z"));

    const dev = await t.member("dev.one");
    expect(await local(dev.root, "feature.manyFiles")).toBeNull();
    await runGit(["config", "--local", "core.untrackedCache", "false"], dev.root);
    await executeUseCase(integrate, { instance: "pdi" }, dev.at("2026-10-05T12:05:00Z"));
    expect(await local(dev.root, "feature.manyFiles")).toBe("true");
    expect(await local(dev.root, "core.untrackedCache")).toBe("false");

    const other = await t.member("dev.two");
    await executeUseCase(pull, { instance: "pdi" }, other.at("2026-10-05T12:05:00Z"));
    expect(await local(other.root, "feature.manyFiles")).toBe("true");
    expect(await local(other.root, "core.untrackedCache")).toBe("true");
  });
});
