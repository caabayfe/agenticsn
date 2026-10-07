import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CredentialStore, TrustedSettings } from "@snagentic/core";
import { YamlProfileStore } from "../../src/adapters/profiles/yaml-profile-store";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import { runCli } from "../../src/cli/run-cli";
import { USE_CASES } from "../../src/registry/registry";
import type { UseCaseContext } from "../../src/registry/use-case";
import { captureIo, FAKE_CONTEXT } from "../support/fakes";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

// Like the keychain: the secret is stored with the url and kind it was typed for.
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

async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "snagentic-instances-")));
  temporary.push(base);
  const root = join(base, "workspace");
  const workspaces = new FsWorkspaceStore();
  await workspaces.create(root, { layout: 1, createdWith: "test" });
  const credentials = memoryCredentials();
  const roles = ["admin"];
  const prompts: string[] = [];
  const context: UseCaseContext = {
    ...FAKE_CONTEXT,
    workspaces,
    profiles: new YamlProfileStore(),
    credentials,
    secrets: {
      read: async (prompt) => {
        prompts.push(prompt);
        return "typed-secret";
      },
    },
    connections: {
      open: () => ({
        query: async (query) =>
          String(query.table) === "sys_user_has_role"
            ? roles
                .filter(
                  (role) =>
                    query.query.includes(`role.name=${role}`) ||
                    query.query.includes("role.nameIN"),
                )
                .map((role) => ({ "role.name": role, sys_id: role }))
            : [{ sys_id: "u1", user_name: "admin", sys_updated_on: "2026-09-23 20:12:26" }],
        fingerprint: async () => ({ count: 0, maxUpdatedOn: null }),
        writer: {
          insert: async () => ({}),
          update: async () => ({}),
        },
        countBy: async () => new Map(),
        count: async () => 0,
        serverCost: async () => {
          throw new Error("not used");
        },
        plugins: {
          activate: async () => {
            throw new Error("not used");
          },
          progress: async () => {
            throw new Error("not used");
          },
        },
        stats: () => ({
          requests: 3,
          retries: 0,
          semaphoreWaitMs: 0,
          transactionIds: [],
          concurrencyLimit: 2,
          peakConcurrency: 2,
          requestMs: 0,
        }),
      }),
    },
    host: { cwd: join(root, "instances"), home: base, version: "test" },
  };
  const run = async (...argv: string[]) => {
    const io = captureIo();
    const exitCode = await runCli(argv, USE_CASES, context, io, {
      version: "test",
      serveMcp: async () => {},
    });
    return { exitCode, out: io.out(), err: io.err() };
  };
  return { base, root, credentials, roles, prompts, run };
}

describe("instance commands", () => {
  it("adds a profile from any folder inside the workspace", async () => {
    const { root, run } = await setup();
    const added = await run("instance", "add", "pdi", "--url", "dev312411", "--username", "admin");
    expect(added.exitCode).toBe(0);
    expect(await readFile(join(root, "instances/pdi/instance.yaml"), "utf8")).toContain(
      "url: https://dev312411.service-now.com",
    );
    expect(added.out).toContain("snagentic auth login pdi");
  });

  it("lists profiles as JSON for scripts and agents", async () => {
    const { run } = await setup();
    await run("instance", "add", "pdi", "--url", "dev312411", "--username", "admin");
    const listed = await run("instance", "list", "--format", "json");
    expect(JSON.parse(listed.out)).toEqual({
      instances: [
        {
          name: "pdi",
          url: "https://dev312411.service-now.com",
          kind: "development",
          username: "admin",
        },
      ],
    });
  });

  it("lists profiles as an aligned table, or explains how to add the first one", async () => {
    const { run } = await setup();
    expect((await run("instance", "list")).out).toContain("no instances yet");
    await run("instance", "add", "pdi", "--url", "dev312411", "--username", "admin");
    await run(
      "instance",
      "add",
      "acme-test",
      "--url",
      "acmetest",
      "--username",
      "ro",
      "--kind",
      "test",
      "--acknowledge-read-only",
    );
    expect((await run("instance", "list")).out).toBe(
      [
        "acme-test  test         ro     https://acmetest.service-now.com",
        "pdi        development  admin  https://dev312411.service-now.com",
        "",
      ].join("\n"),
    );
  });

  it("requires --acknowledge-read-only for a production instance", async () => {
    const { run } = await setup();
    const refused = await run(
      "instance",
      "add",
      "prod",
      "--url",
      "acme",
      "--username",
      "ro",
      "--kind",
      "production",
    );
    expect(refused.exitCode).toBe(5);
    expect(refused.err).toContain("--acknowledge-read-only");
    const accepted = await run(
      "instance",
      "add",
      "prod",
      "--url",
      "acme",
      "--username",
      "ro",
      "--kind",
      "production",
      "--acknowledge-read-only",
    );
    expect(accepted.exitCode).toBe(0);
  });

  it("rejects an instance name that is not folder- and branch-safe", async () => {
    const { run } = await setup();
    expect((await run("instance", "add", "My PDI", "--url", "x", "--username", "a")).exitCode).toBe(
      2,
    );
  });

  it("removes a profile and, on request, its stored credentials", async () => {
    const { run, credentials } = await setup();
    await run("instance", "add", "pdi", "--url", "dev312411", "--username", "admin");
    await run("auth", "login", "pdi");
    const removed = await run("instance", "remove", "pdi", "--forget-credentials");
    expect(removed.exitCode).toBe(0);
    expect(credentials.secrets.size).toBe(0);
    expect((await run("instance", "list", "--format", "json")).out).toContain('"instances": []');
  });

  it("uses --workspace instead of the current folder", async () => {
    const { root, base, run } = await setup();
    const outside = await run("--workspace", root, "instance", "list", "--format", "json");
    expect(outside.exitCode).toBe(0);
    expect(base).not.toBe(root);
  });

  it("explains how to create a workspace when there is none", async () => {
    const { base, run } = await setup();
    const result = await run("--workspace", join(base, "nowhere"), "instance", "list");
    expect(result.exitCode).toBe(3);
    expect(result.err).toContain("snagentic init");
  });
});

describe("auth commands", () => {
  it("stores the typed secret for the instance and removes it on logout", async () => {
    const { run, credentials } = await setup();
    await run("instance", "add", "pdi", "--url", "dev312411", "--username", "admin");
    const login = await run("auth", "login", "pdi");
    expect(login.exitCode).toBe(0);
    expect(credentials.secrets.get("pdi")).toBe("typed-secret");
    expect(login.out).not.toContain("typed-secret");
    const logout = await run("auth", "logout", "pdi");
    expect(logout.exitCode).toBe(0);
    expect(credentials.secrets.size).toBe(0);
  });

  it("adds an OAuth client and asks for its client secret, never a password (ADR-0021)", async () => {
    const { root, run, credentials, prompts } = await setup();
    const added = await run(
      "instance",
      "add",
      "pdi",
      "--url",
      "dev312411",
      "--username",
      "admin",
      "--client-id",
      "0123abcd",
    );
    expect(added.exitCode).toBe(0);
    expect(await readFile(join(root, "instances/pdi/instance.yaml"), "utf8")).toContain(
      "method: oauth-client-credentials",
    );
    const login = await run("auth", "login", "pdi");
    expect(login.exitCode).toBe(0);
    expect(prompts).toEqual(["client secret for oauth:0123abcd@dev312411.service-now.com: "]);
    expect(credentials.secrets.get("pdi")).toBe("typed-secret");
  });

  it("stores nothing when the credential does not match the profile's kind", async () => {
    const { run, credentials, roles } = await setup();
    roles.push("snc_read_only");
    await run("instance", "add", "pdi", "--url", "dev312411", "--username", "admin");
    const login = await run("auth", "login", "pdi");
    expect(login.exitCode).not.toBe(0);
    expect(login.err).toContain("snc_read_only");
    expect(credentials.secrets.size).toBe(0);
  });

  it("does not use the password after instance.yaml changes, until a person logs in again", async () => {
    const { run, root } = await setup();
    await run("instance", "add", "pdi", "--url", "dev312411", "--username", "admin");
    await run("auth", "login", "pdi");
    const file = join(root, "instances/pdi/instance.yaml");
    await writeFile(file, (await readFile(file, "utf8")).replace("dev312411", "evil"));
    const result = await run("doctor", "--instance", "pdi", "--format", "json");
    const report: { checks: { name: string; status: string; detail: string }[] } = JSON.parse(
      result.out,
    );
    expect(report.checks.find((check) => check.name === "credentials")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("url is https://evil.service-now.com"),
    });
    expect(report.checks.find((check) => check.name === "connection")?.status).toBe("unavailable");
  });

  it("is not offered to agents over MCP", () => {
    const exposed = USE_CASES.filter((useCase) => useCase.mcp).map((useCase) => useCase.group);
    expect(exposed).not.toContain("auth");
  });
});

describe("doctor --instance", () => {
  it("checks credentials, connection, roles, timestamps and load of a workspace instance", async () => {
    const { run } = await setup();
    await run("instance", "add", "pdi", "--url", "dev312411", "--username", "admin");
    await run("auth", "login", "pdi");
    const result = await run("doctor", "--instance", "pdi", "--format", "json");
    const report: { ok: boolean; checks: { name: string; status: string }[] } = JSON.parse(
      result.out,
    );
    expect(report.ok).toBe(true);
    expect(report.checks.slice(-5).map((check) => `${check.name}:${check.status}`)).toEqual([
      "credentials:ok",
      "connection:ok",
      "roles:ok",
      "timestamps:ok",
      "load:ok",
    ]);
  });
});
