// Live round trip of Fluent authoring (ADR-0031, ADR-0033), through the CLI from source, in a new
// workspace, against a development instance: adopt, create, update, drift and refresh, delete.
// Opt-in; it writes a property of the S11 test application and deletes it again:
//   SNAGENTIC_LIVE_INSTANCE=pdi2 SNAGENTIC_LIVE_WORKSPACE=../spaces/pdi2 bun test tests/live
import { afterAll, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const INSTANCE = process.env["SNAGENTIC_LIVE_INSTANCE"];
const SOURCE_WORKSPACE = resolve(process.env["SNAGENTIC_LIVE_WORKSPACE"] ?? ".");
const MAIN = resolve(import.meta.dir, "../../packages/cli/src/main.ts");
// The S11 spike application on pdi2 and its script include.
const SCOPE = "x_2222332_s11";
const SCRIPT_INCLUDE = "sys_script_include:123833b4d97d48be8e9ec5ea16f27764";
const PROPERTY = `${SCOPE}.live_round_trip_${Date.now()}`;
const LIVE_TIMEOUT = 600_000;

const base = mkdtempSync(join(tmpdir(), "snagentic-live-"));
const root = join(base, "w");
const project = join(root, "source", SCOPE);
const definition = join(project, "src/fluent/live.now.ts");
afterAll(() => rmSync(base, { recursive: true, force: true }));

function run(...args: string[]): { code: number; json: Record<string, unknown> } {
  const result = Bun.spawnSync(["bun", MAIN, ...args, "--workspace", root, "--format", "json"], {
    env: { ...process.env, NO_TELEMETRY: "1" },
  });
  const text = result.stdout.toString();
  return { code: result.exitCode, json: text.trim() === "" ? {} : JSON.parse(text) };
}

function git(...args: string[]): string {
  const result = Bun.spawnSync(
    ["git", "-c", "user.name=live", "-c", "user.email=live@example.com", ...args],
    {
      cwd: root,
    },
  );
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

function commit(message: string): void {
  // Without the pre-commit hook, keys.ts is written by hand, as the docs say.
  run("fluent-keys", `source/${SCOPE}`);
  git("add", "-A");
  git("commit", "-qm", message);
}

const property = (
  value: string,
  description = "snagentic live round trip",
) => `import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['live_round_trip'],
    table: 'sys_properties',
    data: {
        name: '${PROPERTY}',
        value: '${value}',
        type: 'string',
        description: '${description}',
    },
})
`;

function planAndPush(): { plan: Record<string, unknown>; push: Record<string, unknown> } {
  const plan = run("plan-push", "--instance", INSTANCE ?? "", "--allow-collisions").json;
  expect(plan["ready"]).toBe(true);
  const pushed = run(
    "push",
    "--instance",
    INSTANCE ?? "",
    "--plan",
    String(plan["planId"]),
    "--confirm",
    "--allow-collisions",
  );
  expect(pushed.json).toMatchObject({ notCaptured: 0, notApplied: 0 });
  return { plan, push: pushed.json };
}

describe.skipIf(INSTANCE === undefined)("Fluent authoring round trip (live)", () => {
  it(
    "adopts, creates, updates, refreshes after drift, and deletes",
    () => {
      expect(run("init", root).code).toBe(0);
      mkdirSync(join(root, "instances", INSTANCE ?? ""), { recursive: true });
      cpSync(
        join(SOURCE_WORKSPACE, "instances", INSTANCE ?? "", "instance.yaml"),
        join(root, "instances", INSTANCE ?? "", "instance.yaml"),
      );
      git("add", "-A");
      git("commit", "-qm", "the instance");

      const adopted = run("adopt", "--instance", INSTANCE ?? "", SCRIPT_INCLUDE);
      expect(adopted.json).toMatchObject({
        projects: [{ path: `source/${SCOPE}`, created: true }],
      });
      commit("adopt E2EUtil");
      expect(run("plan-push", "--instance", INSTANCE ?? "").json).toMatchObject({
        units: [],
        problems: [],
      });

      writeFileSync(definition, property("1"));
      commit("a property");
      expect(planAndPush().plan).toMatchObject({
        units: [{ table: "sys_properties", operation: "create" }],
      });

      // A record written by hand takes the SDK's own form once refreshed: the instance's defaults
      // (ignore_cache, is_private) join it, so later merges compare like with like.
      const keysNow = readFileSync(join(project, "src/fluent/generated/keys.ts"), "utf8");
      const created = /live_round_trip: \{[^}]*id: '([0-9a-f]{32})'/.exec(keysNow)?.[1] ?? "";
      const normalized = run(
        "adopt",
        "--instance",
        INSTANCE ?? "",
        "--refresh",
        `sys_properties:${created}`,
      );
      expect(normalized.json).toMatchObject({ conflicts: [] });
      commit("the property in the SDK's form");
      expect(run("plan-push", "--instance", INSTANCE ?? "").json).toMatchObject({
        units: [],
        problems: [],
      });

      writeFileSync(
        definition,
        readFileSync(definition, "utf8").replace("value: '1'", "value: '2'"),
      );
      commit("its value");
      expect(planAndPush().plan).toMatchObject({
        units: [{ operation: "load", changes: ["sys_properties.value"] }],
      });

      // Someone changes its value on the instance while its description changes in source: plan
      // refuses the unit until the instance's change is in source.
      const keys = readFileSync(join(project, "src/fluent/generated/keys.ts"), "utf8");
      const sysId = /live_round_trip: \{[^}]*id: '([0-9a-f]{32})'/.exec(keys)?.[1] ?? "";
      const patched = Bun.spawnSync(["bun", "-e", patchScript(sysId)], { env: process.env });
      expect(patched.exitCode).toBe(0);
      writeFileSync(
        definition,
        readFileSync(definition, "utf8").replace(
          "'snagentic live round trip'",
          "'edited in source'",
        ),
      );
      commit("its description");
      expect(run("plan-push", "--instance", INSTANCE ?? "").json).toMatchObject({
        problems: [{ kind: "drift" }],
      });
      const refreshed = run(
        "adopt",
        "--instance",
        INSTANCE ?? "",
        "--refresh",
        `sys_properties:${sysId}`,
      );
      expect(refreshed.json).toMatchObject({ conflicts: [] });
      commit("refresh the property from the instance");
      const merged = readFileSync(definition, "utf8");
      expect(merged).toContain("'3'");
      expect(merged).toContain("'edited in source'");
      expect(planAndPush().plan).toMatchObject({
        units: [{ operation: "load", changes: ["sys_properties.description"] }],
      });

      writeFileSync(definition, `Now.del('sys_properties', { name: '${PROPERTY}' })\n`);
      commit("delete the property");
      expect(planAndPush().plan).toMatchObject({ units: [{ operation: "delete" }] });
      expect(run("plan-push", "--instance", INSTANCE ?? "").json).toMatchObject({
        units: [],
        problems: [],
      });
    },
    LIVE_TIMEOUT,
  );
});

// A Table API edit made "by someone else", through snagentic's own client and credentials.
function patchScript(sysId: string): string {
  const adapters = resolve(import.meta.dir, "../../packages/cli/src/adapters");
  return `
    import { EnvironmentCredentialStore } from "${adapters}/credentials/environment-credential-store";
    import { KeychainCredentialStore } from "${adapters}/credentials/keychain-credential-store";
    import { LayeredCredentialStore } from "${adapters}/credentials/layered-credential-store";
    import { YamlProfileStore } from "${adapters}/profiles/yaml-profile-store";
    import { fetchTransport } from "${adapters}/servicenow/fetch-transport";
    import { RequestScheduler } from "${adapters}/servicenow/request-scheduler";
    import { ServiceNowClient } from "${adapters}/servicenow/servicenow-client";
    import { getInstance, InstanceName, resolveSecret } from "${resolve(import.meta.dir, "../../packages/core/src/index")}";
    const profile = await getInstance("${root}", InstanceName.parse("${INSTANCE}"), new YamlProfileStore());
    const secret = await resolveSecret(profile, new LayeredCredentialStore(new EnvironmentCredentialStore(process.env), new KeychainCredentialStore()));
    const client = new ServiceNowClient(profile, secret, new RequestScheduler(fetchTransport()), "snagentic-live-test");
    await client.sendJson("PATCH", "/api/now/table/sys_properties/${sysId}", { value: "3" }, "edit", new AbortController().signal);
  `;
}
