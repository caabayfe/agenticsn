import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import type { Row } from "@snagentic/core";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { executeUseCase } from "../../src/registry/execute";
import { pull } from "../../src/registry/pull";
import { TEAM_TIMEOUT, team } from "../support/team-workspace";

setDefaultTimeout(TEAM_TIMEOUT);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

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
    {
      sys_id: RULE,
      sys_class_name: "sys_script",
      name: "Rule",
      script: "run();",
      sys_scope: "global",
    },
    {
      sys_id: "00000000000000000000000000000002",
      sys_class_name: "sys_script",
      name: "Other",
      script: "other();",
      sys_scope: "global",
    },
  ],
};
const OTHER =
  "instances/pdi/metadata/global/sys_script/other--00000000000000000000000000000002.yaml";

async function newTeam() {
  const t = await team(structuredClone(DATA));
  cleanups.push(t.cleanup);
  return t;
}

const tipOf = (root: string, ref = "servicenow-remote/pdi") =>
  runGitOrThrow(["rev-parse", ref], root).then((out) => out.trim());

describe("pull with a shared mirror (ADR-0052)", () => {
  it("starts from the shared mirror, and asks the instance nothing while it is current", async () => {
    const t = await newTeam();
    const ci = await t.member();
    const published = await executeUseCase(
      pull,
      { instance: "pdi", publish: true },
      ci.at("2026-10-05T12:00:00Z"),
    );
    expect(published.output).toMatchObject({ mode: "full", shared: { published: true } });
    expect(await tipOf(t.origin, "refs/heads/servicenow-remote/pdi")).toBe(
      String(published.output["commit"]),
    );
    const dev = await t.member("dev.one");
    const before = t.instance.queries.length;
    const current = await executeUseCase(pull, { instance: "pdi" }, dev.at("2026-10-05T12:05:00Z"));
    expect(current.output).toMatchObject({
      mode: "current",
      requests: 0,
      shared: { from: "shared", ageMinutes: 5, maxAgeMinutes: 30, published: false },
    });
    expect(t.instance.queries.length).toBe(before);
    expect(await tipOf(dev.root)).toBe(String(published.output["commit"]));
    expect(pull.render(current.output as never, "text")).toContain("the mirror is current");
    // Older than the max age, and published by svc_ci: the developer waits for it (A2).
    const later = await executeUseCase(pull, { instance: "pdi" }, dev.at("2026-10-05T12:30:00Z"));
    expect(later.output).toMatchObject({
      mode: "stale",
      requests: 0,
      shared: { ageMinutes: 30, publisher: "svc_ci" },
    });
    expect(t.instance.queries.length).toBe(before);
    expect(pull.render(later.output as never, "text")).toContain(
      "pdi: the shared mirror is stale (pulled 30 min ago, max 30); nothing was asked of the instance",
    );
    const now = await executeUseCase(
      pull,
      { instance: "pdi", now: true },
      dev.at("2026-10-05T12:31:00Z"),
    );
    expect(now.output["mode"]).toBe("incremental");
  });

  it("refuses to publish for a user other than the one the shared state names", async () => {
    const t = await newTeam();
    await executeUseCase(
      pull,
      { instance: "pdi", publish: true },
      (await t.member()).at("2026-10-05T12:00:00Z"),
    );
    const dev = await t.member("dev.one");
    const before = t.instance.queries.length;
    await expect(
      executeUseCase(pull, { instance: "pdi", publish: true }, dev.at("2026-10-05T13:00:00Z")),
    ).rejects.toMatchObject({ code: "publish-refused" });
    expect(t.instance.queries.length).toBe(before);
  });

  it("records each clone's own user, whatever instance.yaml names (ADR-0054)", async () => {
    const t = await newTeam();
    const ci = await t.member("svc_ci");
    await executeUseCase(pull, { instance: "pdi", publish: true }, ci.at("2026-10-05T12:00:00Z"));
    const dev = await t.member("dev.one");
    const events: string[] = [];
    const progress = {
      signal: new AbortController().signal,
      progress: (e: { message: string }) => {
        events.push(e.message);
      },
    };
    await executeUseCase(
      pull,
      { instance: "pdi", now: true },
      dev.at("2026-10-05T13:00:00Z"),
      progress,
    );
    expect(events[0]).toBe("pulling pdi as dev.one (this clone)");
    expect(await runGitOrThrow(["status", "--porcelain", "instances"], dev.root)).toBe("");
    const viaVariable = await t.member("dev.two", "environment");
    await expect(
      executeUseCase(
        pull,
        { instance: "pdi", publish: true },
        viaVariable.at("2026-10-05T13:00:00Z"),
      ),
    ).rejects.toMatchObject({
      code: "publish-refused",
      message: expect.stringContaining("dev.two"),
    });
  });

  it("never removes a record by absence when another user pulls", async () => {
    const t = await newTeam();
    await executeUseCase(
      pull,
      { instance: "pdi", publish: true },
      (await t.member()).at("2026-10-05T12:00:00Z"),
    );
    t.instance.tables["sys_script"] = t.instance.tables["sys_script"]?.slice(0, 1) ?? [];
    const dev = await t.member("dev.one");
    await executeUseCase(pull, { instance: "pdi", verify: true }, dev.at("2026-10-05T13:00:00Z"));
    expect(
      await runGitOrThrow(["ls-tree", "-r", "--name-only", "servicenow-remote/pdi"], dev.root),
    ).toContain(OTHER);
    const ci = await t.member();
    await executeUseCase(pull, { instance: "pdi", verify: true }, ci.at("2026-10-05T13:00:00Z"));
    expect(
      await runGitOrThrow(["ls-tree", "-r", "--name-only", "servicenow-remote/pdi"], ci.root),
    ).not.toContain(OTHER);
  });

  it("refuses a shared watermark later than the instance's own clock", async () => {
    const t = await newTeam();
    await executeUseCase(
      pull,
      { instance: "pdi", publish: true },
      (await t.member()).at("2026-10-05T12:00:00Z"),
    );
    t.instance.clock.time = Date.parse("2026-10-05T11:00:00Z");
    const dev = await t.member("dev.one");
    await expect(
      executeUseCase(pull, { instance: "pdi", now: true }, dev.at("2026-10-05T12:10:00Z")),
    ).rejects.toMatchObject({ code: "watermark-in-future" });
  });

  it("publishes fast-forward only: a refused push continues from the newer commit, once", async () => {
    const t = await newTeam();
    await executeUseCase(
      pull,
      { instance: "pdi", publish: true },
      (await t.member()).at("2026-10-05T12:00:00Z"),
    );
    const first = await t.member();
    const second = await t.member();
    const rule = t.instance.tables["sys_script"]?.[0];
    Object.assign(rule ?? {}, { script: "changed();", sys_updated_on: "2026-10-05 12:20:00" });
    // The second publisher's push races the first: the first publishes between its fetch and push.
    let raced = false;
    // Older than the 30-minute max age after the race too, so the retry pulls again.
    const racing = second.at("2026-10-05T13:20:00Z");
    const context = {
      ...racing,
      sharedMirror: {
        ...racing.sharedMirror,
        publish: async (...args: Parameters<typeof racing.sharedMirror.publish>) => {
          if (!raced) {
            raced = true;
            await executeUseCase(
              pull,
              { instance: "pdi", publish: true },
              first.at("2026-10-05T12:35:00Z"),
            );
          }
          return racing.sharedMirror.publish(...args);
        },
      },
    };
    const { output } = await executeUseCase(pull, { instance: "pdi", publish: true }, context);
    expect(output).toMatchObject({ shared: { published: true } });
    const history = await runGitOrThrow(
      ["rev-list", "--parents", "refs/heads/servicenow-remote/pdi"],
      t.origin,
    );
    // One line of history: every commit has at most one parent.
    expect(
      history
        .trim()
        .split("\n")
        .every((line) => line.split(" ").length <= 2),
    ).toBe(true);
    expect(history.trim().split("\n")).toHaveLength(3);
  });

  it("stops after a second refused push, naming the remote", async () => {
    const t = await newTeam();
    const ci = (await t.member()).at("2026-10-05T12:00:00Z");
    const refusing = {
      ...ci,
      sharedMirror: { ...ci.sharedMirror, publish: async () => "rejected" as const },
    };
    await expect(
      executeUseCase(pull, { instance: "pdi", publish: true }, refusing),
    ).rejects.toMatchObject({
      code: "publish-rejected",
      message: expect.stringContaining("origin"),
    });
  });

  it("asks for a shared mirror before publishing", async () => {
    const t = await newTeam();
    const ci = await t.member();
    const profile = `${ci.root}/instances/pdi/instance.yaml`;
    const text = await Bun.file(profile).text();
    await Bun.write(profile, text.replace(/shared_mirror:\n( {2}.*\n)+/, ""));
    await expect(
      executeUseCase(pull, { instance: "pdi", publish: true }, ci.at("2026-10-05T12:00:00Z")),
    ).rejects.toMatchObject({ code: "publish-needs-shared-mirror" });
  });
});
