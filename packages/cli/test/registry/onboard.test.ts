import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthenticationFailedError,
  type CredentialStore,
  InstanceHibernatingError,
  type TrustedSettings,
} from "@snagentic/core";
import { fakeInstance } from "../../../core/test/support/fake-instance";
import { WorkspaceAuthoring } from "../../src/adapters/fluent/workspace-authoring";
import { gitInspector } from "../../src/adapters/git/git-inspector";
import { gitIntegrator } from "../../src/adapters/git/git-integrator";
import { GitMirror } from "../../src/adapters/git/git-mirror";
import { gitSharedMirror } from "../../src/adapters/git/git-shared-mirror";
import { YamlProfileStore } from "../../src/adapters/profiles/yaml-profile-store";
import { syncStateStore } from "../../src/adapters/state/mirror-sync-state-store";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import { executeUseCase } from "../../src/registry/execute";
import { onboard } from "../../src/registry/onboard";
import { USE_CASES } from "../../src/registry/registry";
import type { UseCaseContext } from "../../src/registry/use-case";
import { connectionsTo, FAKE_CONTEXT, memoryIdentities } from "../support/fakes";
import { TEAM_TIMEOUT } from "../support/team-workspace";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function memoryCredentials(): CredentialStore & { secrets: Map<string, string> } {
  const secrets = new Map<string, string>();
  const trusted = new Map<string, TrustedSettings>();
  return {
    secrets,
    read: async (profile) => {
      const secret = secrets.get(profile.name);
      return secret === undefined
        ? null
        : { secret, source: "keychain", trusted: trusted.get(profile.name) ?? null };
    },
    write: async (profile, secret) => {
      secrets.set(profile.name, secret);
      trusted.set(profile.name, { url: profile.url, kind: profile.kind });
    },
    remove: async (profile) => secrets.delete(profile.name),
  };
}

// The instance answers every read with `answer`: rows, or an error it raises.
async function setup(answer: Error | null) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "snagentic-onboard-")));
  temporary.push(base);
  const credentials = memoryCredentials();
  const prompts: string[] = [];
  const context: UseCaseContext = {
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    profiles: new YamlProfileStore(),
    credentials,
    identities: memoryIdentities(),
    secrets: {
      read: async (prompt) => {
        prompts.push(prompt);
        return "typed-secret";
      },
    },
    connections: connectionsTo({
      query: async (query: { table: unknown }) => {
        if (answer !== null) {
          throw answer;
        }
        return String(query.table) === "sys_user_has_role"
          ? []
          : [{ sys_id: "u1", user_name: "admin", sys_updated_on: "2026-09-23 20:12:26" }];
      },
    } as never),
    host: { cwd: join(base, "cwd"), home: base, version: "test" },
  };
  return { base, context, credentials, prompts, root: join(base, "ws") };
}

const INPUT = { name: "pdi", url: "dev312411", username: "admin" };

describe("onboard", () => {
  it("creates the workspace and the profile, then stops at a sleeping instance with how to wake it", async () => {
    const { context, root, credentials } = await setup(
      new InstanceHibernatingError("https://dev312411.service-now.com"),
    );
    const { output, exitCode } = await executeUseCase(onboard, { ...INPUT, path: root }, context);
    expect(output).toMatchObject({ stoppedAt: "sign-in", answer: { outcome: "asleep" } });
    expect(JSON.stringify(output)).toContain("developer.servicenow.com");
    expect(exitCode).not.toBe(0);
    const shown = onboard.render(output as Parameters<typeof onboard.render>[0], "text");
    expect(shown).toContain("stopped at sign-in");
    expect(shown).toContain("hint: wake the instance");
    expect(await readFile(join(root, "instances/pdi/instance.yaml"), "utf8")).toContain(
      "https://dev312411.service-now.com",
    );
    expect(credentials.secrets.size).toBe(0);
  });

  it("names the Basic authentication role when the instance refuses the user", async () => {
    const { context, root, credentials } = await setup(new AuthenticationFailedError("pdi"));
    const { output } = await executeUseCase(onboard, { ...INPUT, path: root }, context);
    expect(output).toMatchObject({ stoppedAt: "sign-in", answer: { outcome: "unauthorized" } });
    expect(JSON.stringify(output)).toContain("snc_basic_auth_api_access");
    expect(credentials.secrets.size).toBe(0);
  });

  it("continues in an existing workspace and profile on a second run", async () => {
    const { context, root } = await setup(new InstanceHibernatingError("https://x"));
    await executeUseCase(onboard, { ...INPUT, path: root }, context);
    const { output } = await executeUseCase(onboard, { ...INPUT, path: root }, context);
    expect(output["steps"]).toEqual([
      { step: "workspace", did: "already" },
      { step: "profile", did: "already" },
    ]);
  });

  it("refuses a profile that already names another instance", async () => {
    const { context, root } = await setup(new InstanceHibernatingError("https://x"));
    await executeUseCase(onboard, { ...INPUT, path: root }, context);
    await expect(
      executeUseCase(onboard, { ...INPUT, url: "dev999999", path: root }, context),
    ).rejects.toThrow("already names");
  });

  it("needs the read-only acknowledgement for a production instance", async () => {
    const { context, root } = await setup(null);
    await expect(
      executeUseCase(onboard, { ...INPUT, kind: "production", path: root }, context),
    ).rejects.toThrow("read-only");
  });

  it("says which doctor checks failed and how to look at them", () => {
    const shown = onboard.render(
      {
        root: "/w",
        instance: "pdi",
        steps: [{ step: "sign-in", did: "done" }],
        stoppedAt: "doctor",
        answer: { outcome: "ready" },
        failedChecks: ["roles", "timestamps"],
        nextSteps: [],
      },
      "text",
    );
    expect(shown).toContain("doctor failed: roles, timestamps");
    expect(shown).toContain("snagentic doctor --instance pdi");
  });

  it("is not offered to agents, because it reads a secret", () => {
    const registered = USE_CASES.find((useCase) => useCase.name === "onboard");
    expect(registered?.mcp).toBe(false);
  });
});

const SDK = async () => ({
  sdkVersion: "4.13.6",
  build: async () => ({ success: true as const, records: [] }),
  transform: async () => ({ success: false as const, message: "unused" }),
});

// A whole instance behind the fake reader, with real git: the success path end to end.
async function wholeSetup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "snagentic-onboard-all-")));
  temporary.push(base);
  const instance = fakeInstance({
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
        sys_id: "00000000000000000000000000000001",
        sys_class_name: "sys_script",
        name: "Rule",
        script: "run();",
        sys_scope: "global",
      },
    ],
    sys_user: [{ sys_id: "u1", user_name: "admin", sys_updated_on: "2026-09-23 20:12:26" }],
    sys_user_has_role: [],
  });
  const credentials = memoryCredentials();
  const prompts: string[] = [];
  const context: UseCaseContext = {
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    profiles: new YamlProfileStore(),
    credentials,
    identities: memoryIdentities(),
    secrets: {
      read: async (prompt) => {
        prompts.push(prompt);
        return "typed-secret";
      },
    },
    connections: { open: () => instance.reader, openForWrite: () => instance.reader },
    authoring: (root: string) => ({
      workspace: new WorkspaceAuthoring(root, SDK),
      toolchain: FAKE_CONTEXT.authoring(root).toolchain,
    }),
    syncState: syncStateStore,
    sharedMirror: gitSharedMirror,
    mirrors: { open: (r, name, mode) => GitMirror.open(r, name, mode) },
    integrator: gitIntegrator,
    inspector: gitInspector,
    host: { cwd: join(base, "cwd"), home: base, version: "test" },
  };
  return { context, credentials, prompts, root: join(base, "ws") };
}

describe("onboard, the whole way", () => {
  it(
    "takes a new instance to a pulled, integrated workspace, then continues from inside it",
    async () => {
      const { context, credentials, prompts, root } = await wholeSetup();
      const first = await executeUseCase(onboard, { ...INPUT, path: root }, context);
      expect(first.output).toMatchObject({ stoppedAt: null, root });
      expect((first.output["steps"] as { step: string }[]).map((s) => s.step)).toEqual([
        "workspace",
        "profile",
        "sign-in",
        "doctor",
        "pull",
        "integrate",
      ]);
      expect(first.exitCode).toBe(0);
      expect(prompts).toHaveLength(1);
      expect(credentials.secrets.get("pdi")).toBe("typed-secret");
      expect(JSON.stringify(first.output)).not.toContain("typed-secret");
      expect(first.output["nextSteps"]).toContain("snagentic agent install");
      const shown = onboard.render(first.output as Parameters<typeof onboard.render>[0], "text");
      expect(shown).toContain("pdi is onboarded");
      expect(shown).toContain("snagentic agent install");

      // From inside the workspace, with the password already kept: nothing is asked again.
      const inside = { ...context, host: { ...context.host, cwd: root } };
      const second = await executeUseCase(onboard, INPUT, inside);
      expect(second.output).toMatchObject({ stoppedAt: null, root });
      expect((second.output["steps"] as { step: string; did: string }[]).slice(0, 2)).toEqual([
        { step: "workspace", did: "already" },
        { step: "profile", did: "already" },
      ]);
      expect(prompts).toHaveLength(1);
    },
    TEAM_TIMEOUT,
  );

  it(
    "stops before the pull when a stored credential is refused",
    async () => {
      const { context, credentials, root } = await wholeSetup();
      await executeUseCase(onboard, { ...INPUT, path: root }, context);
      const refusing: UseCaseContext = {
        ...context,
        connections: connectionsTo({
          query: async () => {
            throw new AuthenticationFailedError("pdi");
          },
        } as never),
      };
      const { output, exitCode } = await executeUseCase(
        onboard,
        { ...INPUT, path: root },
        refusing,
      );
      expect(output).toMatchObject({ stoppedAt: "sign-in", answer: { outcome: "unauthorized" } });
      expect(exitCode).not.toBe(0);
      expect(credentials.secrets.get("pdi")).toBe("typed-secret");
    },
    TEAM_TIMEOUT,
  );
});
