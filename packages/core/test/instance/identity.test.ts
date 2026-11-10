import { describe, expect, it } from "bun:test";
import {
  createProfile,
  type IdentityStore,
  InstanceName,
  type InstanceProfile,
  identityMismatch,
  type ProfileStore,
  profileForLogin,
  rememberIdentity,
  resolveUsername,
  usernameResolvingProfiles,
  usernameSourceLabel,
  usernameVariable,
  withUsername,
} from "@snagentic/core";

const ROOT = "/work/clone-a";

const PROFILE = createProfile({
  name: InstanceName.parse("acme-dev"),
  url: "acme",
  username: "puller",
  kind: "development",
  acknowledgeReadOnly: false,
});

const OAUTH = createProfile({
  name: InstanceName.parse("acme-dev"),
  url: "acme",
  username: "oauth_app_user",
  clientId: "client1",
  kind: "development",
  acknowledgeReadOnly: false,
});

// Like the keychain item: one identity per clone and instance.
function memoryIdentities(entries: Record<string, string> = {}): IdentityStore & {
  readonly saved: Map<string, string>;
} {
  const saved = new Map(Object.entries(entries));
  const key = (root: string, profile: InstanceProfile) => `${root}|${profile.name}`;
  return {
    saved,
    read: async (root, profile) => saved.get(key(root, profile)) ?? null,
    write: async (root, profile, username) => {
      saved.set(key(root, profile), username);
    },
    remove: async (root, profile) => saved.delete(key(root, profile)),
  };
}

const NO_ENV = {};

describe("username resolution (ADR-0054)", () => {
  it("names the environment variable after the instance", () => {
    expect(usernameVariable(PROFILE)).toBe("SNAGENTIC_ACME_DEV_USERNAME");
  });

  it("takes the username from instance.yaml when nothing else names one", async () => {
    const resolved = await resolveUsername(ROOT, PROFILE, {
      environment: NO_ENV,
      clone: memoryIdentities(),
    });
    expect(resolved.auth.username).toBe("puller");
    expect(usernameSourceLabel(resolved)).toBe("instance.yaml");
    expect(resolved).toEqual(PROFILE);
  });

  it("prefers this clone's identity to instance.yaml", async () => {
    const clone = memoryIdentities({ [`${ROOT}|acme-dev`]: "jdoe" });
    const resolved = await resolveUsername(ROOT, PROFILE, { environment: NO_ENV, clone });
    expect(resolved.auth.username).toBe("jdoe");
    expect(usernameSourceLabel(resolved)).toBe("this clone");
  });

  it("prefers the environment to this clone's identity", async () => {
    const clone = memoryIdentities({ [`${ROOT}|acme-dev`]: "jdoe" });
    const environment = { SNAGENTIC_ACME_DEV_USERNAME: "ci_puller" };
    const resolved = await resolveUsername(ROOT, PROFILE, { environment, clone });
    expect(resolved.auth.username).toBe("ci_puller");
    expect(usernameSourceLabel(resolved)).toBe("environment");
  });

  it("ignores an empty variable", async () => {
    const clone = memoryIdentities({ [`${ROOT}|acme-dev`]: "jdoe" });
    const environment = { SNAGENTIC_ACME_DEV_USERNAME: "" };
    const resolved = await resolveUsername(ROOT, PROFILE, { environment, clone });
    expect(resolved.auth.username).toBe("jdoe");
  });

  it("keeps the identity of another clone to that clone", async () => {
    const clone = memoryIdentities({ "/work/clone-b|acme-dev": "jdoe" });
    const resolved = await resolveUsername(ROOT, PROFILE, { environment: NO_ENV, clone });
    expect(resolved.auth.username).toBe("puller");
  });

  it("refuses a username in the environment that queries can't carry", async () => {
    const environment = { SNAGENTIC_ACME_DEV_USERNAME: "a^b" };
    await expect(
      resolveUsername(ROOT, PROFILE, { environment, clone: memoryIdentities() }),
    ).rejects.toMatchObject({
      code: "invalid-input",
      message: expect.stringContaining("SNAGENTIC_ACME_DEV_USERNAME"),
    });
  });

  it("leaves an OAuth client's user alone (ADR-0021)", async () => {
    const clone = memoryIdentities({ [`${ROOT}|acme-dev`]: "jdoe" });
    const environment = { SNAGENTIC_ACME_DEV_USERNAME: "ci_puller" };
    const resolved = await resolveUsername(ROOT, OAUTH, { environment, clone });
    expect(resolved).toEqual(OAUTH);
    expect(withUsername(OAUTH, "jdoe", "clone")).toEqual(OAUTH);
  });

  it("resolves every profile a store reads or lists, and writes and removes through it", async () => {
    const calls: string[] = [];
    let saved: InstanceProfile | null = PROFILE;
    const raw: ProfileStore = {
      list: async () => (saved === null ? [] : [saved]),
      read: async () => saved,
      write: async (_root, profile) => {
        calls.push(`write ${profile.auth.username}`);
      },
      remove: async () => {
        saved = null;
      },
    };
    const clone = memoryIdentities({ [`${ROOT}|acme-dev`]: "jdoe" });
    const store = usernameResolvingProfiles(raw, { environment: NO_ENV, clone });
    expect((await store.read(ROOT, PROFILE.name))?.auth.username).toBe("jdoe");
    expect((await store.list(ROOT)).map((profile) => profile.auth.username)).toEqual(["jdoe"]);
    await store.write(ROOT, PROFILE);
    expect(calls).toEqual(["write puller"]);
    await store.remove(ROOT, PROFILE.name);
    expect(await store.read(ROOT, PROFILE.name)).toBeNull();
  });

  it("says where the expected user came from when the instance signs in someone else", () => {
    const fromClone = withUsername(PROFILE, "jdoe", "clone");
    const mismatch = identityMismatch(fromClone, "asmith");
    expect(mismatch.message).toContain("signed in as asmith");
    expect(mismatch.message).toContain("this clone's identity names jdoe");
    expect(mismatch.hint).toContain("snagentic auth login acme-dev --username asmith");
    const fromEnvironment = identityMismatch(withUsername(PROFILE, "ci", "environment"), "asmith");
    expect(fromEnvironment.message).toContain("SNAGENTIC_ACME_DEV_USERNAME names ci");
    const fromFile = identityMismatch(PROFILE, "asmith");
    expect(fromFile.message).toContain("instances/acme-dev/instance.yaml names puller");
  });
});

describe("auth login --username (ADR-0054 item 2)", () => {
  it("signs in as the given user, and stores it as this clone's identity", async () => {
    const clone = memoryIdentities();
    const jdoe = profileForLogin(PROFILE, " jdoe ");
    expect(jdoe.auth.username).toBe("jdoe");
    expect(await rememberIdentity(ROOT, jdoe, clone)).toBe(true);
    expect(clone.saved.get(`${ROOT}|acme-dev`)).toBe("jdoe");
  });

  it("keeps the resolved user without --username, and stores no identity for instance.yaml's", async () => {
    const clone = memoryIdentities();
    expect(profileForLogin(PROFILE)).toEqual(PROFILE);
    expect(await rememberIdentity(ROOT, PROFILE, clone)).toBe(false);
    expect(clone.saved.size).toBe(0);
  });

  it("refuses --username for an OAuth client, while the variable names the user, or when queries can't carry it", () => {
    expect(() => profileForLogin(OAUTH, "jdoe")).toThrow("Application User");
    const fromVariable = withUsername(PROFILE, "ci", "environment");
    expect(() => profileForLogin(fromVariable, "jdoe")).toThrow("SNAGENTIC_ACME_DEV_USERNAME");
    expect(() => profileForLogin(PROFILE, "a,b")).toThrow("--username");
  });
});
