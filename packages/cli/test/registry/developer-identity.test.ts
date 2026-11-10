import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usernameResolvingProfiles } from "@snagentic/core";
import {
  KeychainCredentialStore,
  type KeychainEntry,
} from "../../src/adapters/credentials/keychain-credential-store";
import { KeychainIdentityStore } from "../../src/adapters/credentials/keychain-identity-store";
import { YamlProfileStore } from "../../src/adapters/profiles/yaml-profile-store";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import { runCli } from "../../src/cli/run-cli";
import { USE_CASES } from "../../src/registry/registry";
import type { UseCaseContext, WriteConnection } from "../../src/registry/use-case";
import { captureIo, FAKE_CONTEXT } from "../support/fakes";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const unused = async () => {
  throw new Error("not used");
};

// The instance knows each person by their password: it signs in whoever the password is for.
const PASSWORDS: Readonly<Record<string, string>> = {
  "puller-pw": "svc_puller",
  "alice-pw": "alice",
  "bob-pw": "bob",
};

function signedInWith(secret: string): WriteConnection {
  const user = PASSWORDS[secret] ?? "";
  return {
    query: async (query) =>
      String(query.table) === "sys_user_has_role"
        ? query.query.includes("snc_read_only") && !query.query.includes("role.nameIN")
          ? []
          : [{ "role.name": "admin", sys_id: "admin" }]
        : [{ sys_id: "u1", user_name: user, sys_updated_on: "2026-11-10 10:00:00" }],
    fingerprint: async () => ({ count: 0, maxUpdatedOn: null }),
    writer: { insert: unused, update: unused },
    countBy: async () => new Map(),
    count: async () => 0,
    serverCost: unused,
    plugins: { activate: unused, progress: unused },
    apps: { install: unused, progress: unused },
    stats: () => ({
      requests: 1,
      retries: 0,
      timeouts: 0,
      semaphoreWaitMs: 0,
      transactionIds: [],
      concurrencyLimit: 2,
      peakConcurrency: 1,
      requestMs: 0,
    }),
  };
}

function memoryKeychain() {
  const entries = new Map<string, string>();
  const factory = (service: string, account: string): KeychainEntry => {
    const key = `${service}/${account}`;
    return {
      getPassword: async () => entries.get(key),
      setPassword: async (password) => {
        entries.set(key, password);
      },
      deletePassword: async () => entries.delete(key),
    };
  };
  return { entries, factory };
}

// A workspace whose committed instance.yaml names the team's puller, on a machine with a
// keychain shared by every clone on it.
async function setup(keychain = memoryKeychain()) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "snagentic-identity-")));
  temporary.push(base);
  const root = join(base, "workspace");
  await new FsWorkspaceStore().create(root, { layout: 2, createdWith: "test" });
  const environment: Record<string, string> = {};
  let typed = "";
  const identities = new KeychainIdentityStore(keychain.factory);
  const context: UseCaseContext = {
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    profiles: usernameResolvingProfiles(new YamlProfileStore(), {
      environment,
      clone: identities,
    }),
    identities,
    credentials: new KeychainCredentialStore(keychain.factory),
    secrets: { read: async () => typed },
    connections: {
      open: (_profile, secret) => signedInWith(secret),
      openForWrite: (_profile, secret) => signedInWith(secret),
    },
    host: { cwd: root, home: base, version: "test" },
  };
  const run = async (...argv: string[]) => {
    const io = captureIo();
    const exitCode = await runCli(argv, USE_CASES, context, io, {
      version: "test",
      serveMcp: async () => {},
    });
    return { exitCode, out: io.out(), err: io.err() };
  };
  const type = (secret: string) => {
    typed = secret;
  };
  await run("instance", "add", "pdi", "--url", "dev1", "--username", "svc_puller");
  return { root, keychain, environment, run, type };
}

const SECRET_OF = (user: string) => `snagentic/${user}@dev1.service-now.com`;

async function doctorChecks(run: (...argv: string[]) => Promise<{ out: string }>) {
  const report: { checks: { name: string; status: string; detail: string }[] } = JSON.parse(
    (await run("doctor", "--instance", "pdi", "--format", "json")).out,
  );
  return Object.fromEntries(report.checks.map((check) => [check.name, check]));
}

describe("each developer signs in as themselves (ADR-0054)", () => {
  it("logs in with --username: signs in as that user, stores the secret under it, keeps the identity", async () => {
    const { root, keychain, run, type } = await setup();
    const profileBefore = await readFile(join(root, "instances/pdi/instance.yaml"), "utf8");
    type("alice-pw");
    const login = await run("auth", "login", "pdi", "--username", "alice");
    expect(login.err).toBe("");
    expect(login.exitCode).toBe(0);
    expect(login.out).toContain("this clone signs in to pdi as alice");
    expect(JSON.parse(keychain.entries.get(SECRET_OF("alice")) ?? "{}")).toMatchObject({
      secret: "alice-pw",
    });
    expect(keychain.entries.has(SECRET_OF("svc_puller"))).toBe(false);
    expect(await readFile(join(root, "instances/pdi/instance.yaml"), "utf8")).toBe(profileBefore);

    const listed = JSON.parse((await run("instance", "list", "--format", "json")).out);
    expect(listed.instances[0]).toMatchObject({ username: "alice", usernameSource: "this clone" });
    expect((await run("instance", "list")).out).toContain("alice (this clone)");
    const checks = await doctorChecks(run);
    expect(checks["credentials"]).toMatchObject({
      status: "ok",
      detail: "found for alice@dev1.service-now.com",
    });
    expect(checks["connection"]).toMatchObject({
      status: "ok",
      detail: "https://dev1.service-now.com as alice (this clone)",
    });
  });

  it("refuses a password that signs in someone else, and stores nothing", async () => {
    const { keychain, run, type } = await setup();
    type("bob-pw");
    const login = await run("auth", "login", "pdi", "--username", "alice");
    expect(login.exitCode).not.toBe(0);
    expect(login.err).toContain("signed in as bob");
    expect(keychain.entries.size).toBe(0);
  });

  it("logs in again as the clone's identity without --username", async () => {
    const { keychain, run, type } = await setup();
    type("alice-pw");
    await run("auth", "login", "pdi", "--username", "alice");
    const again = await run("auth", "login", "pdi", "--format", "json");
    expect(JSON.parse(again.out)).toMatchObject({
      account: "alice@dev1.service-now.com",
      usernameSource: "this clone",
    });
    expect(keychain.entries.has(SECRET_OF("svc_puller"))).toBe(false);
  });

  it("finds no secret for an identity that stored none: another person's secret stays theirs", async () => {
    const keychain = memoryKeychain();
    const alice = await setup(keychain);
    alice.type("alice-pw");
    await alice.run("auth", "login", "pdi", "--username", "alice");
    // Another clone on the same machine: no identity of its own, so instance.yaml's user, whose
    // secret nobody stored here.
    const other = await setup(keychain);
    const checks = await doctorChecks(other.run);
    expect(checks["credentials"]).toMatchObject({
      status: "fail",
      detail: expect.not.stringContaining("alice"),
    });
    // Its identity set to alice without her password: login is refused, nothing changes.
    other.type("bob-pw");
    expect((await other.run("auth", "login", "pdi", "--username", "alice")).exitCode).not.toBe(0);
    expect((await doctorChecks(other.run))["credentials"]?.status).toBe("fail");
  });

  it("takes SNAGENTIC_<NAME>_USERNAME first, and says so", async () => {
    const { environment, run, type } = await setup();
    type("alice-pw");
    await run("auth", "login", "pdi", "--username", "alice");
    environment["SNAGENTIC_PDI_USERNAME"] = "bob";
    expect((await run("instance", "list")).out).toContain("bob (environment)");
    const checks = await doctorChecks(run);
    expect(checks["credentials"]?.detail).toContain("bob@dev1.service-now.com");
    const refused = await run("auth", "login", "pdi", "--username", "alice");
    expect(refused.exitCode).not.toBe(0);
    expect(refused.err).toContain("SNAGENTIC_PDI_USERNAME");
  });

  it("logs out: removes the secret and the identity, and falls back to instance.yaml", async () => {
    const { keychain, run, type } = await setup();
    type("alice-pw");
    await run("auth", "login", "pdi", "--username", "alice");
    const logout = await run("auth", "logout", "pdi");
    expect(logout.exitCode).toBe(0);
    expect(logout.out).toContain("deleted stored credentials for alice@dev1.service-now.com");
    expect(logout.out).toContain("the username comes from instance.yaml");
    expect(keychain.entries.size).toBe(0);
    expect((await run("instance", "list")).out).toContain("svc_puller (instance.yaml)");
  });

  it("logs in without --username as instance.yaml's user, and stores no identity (solo mode)", async () => {
    const { keychain, run, type } = await setup();
    type("puller-pw");
    const login = await run("auth", "login", "pdi");
    expect(login.exitCode).toBe(0);
    expect(login.out).not.toContain("this clone signs in");
    expect([...keychain.entries.keys()]).toEqual([SECRET_OF("svc_puller")]);
  });
});
