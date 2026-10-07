import { describe, expect, it } from "bun:test";
import {
  addInstance,
  type CredentialStore,
  createProfile,
  InstanceName,
  type InstanceProfile,
  type InstanceReader,
  listInstances,
  login,
  logout,
  type ProfileStore,
  removeInstance,
  resolveSecret,
} from "@snagentic/core";

function memoryProfiles(): ProfileStore & { saved: Map<string, InstanceProfile> } {
  const saved = new Map<string, InstanceProfile>();
  return {
    saved,
    list: async () => [...saved.values()],
    read: async (_root, name) => saved.get(name) ?? null,
    write: async (_root, profile) => {
      saved.set(profile.name, profile);
    },
    remove: async (_root, name) => {
      saved.delete(name);
    },
  };
}

function memoryCredentials(): CredentialStore & { secrets: Map<string, string> } {
  const secrets = new Map<string, string>();
  return {
    secrets,
    read: async (profile) => {
      const secret = secrets.get(profile.name);
      return secret === undefined
        ? null
        : { secret, source: "keychain", trusted: { url: profile.url, kind: profile.kind } };
    },
    write: async (profile, secret) => {
      secrets.set(profile.name, secret);
    },
    remove: async (profile) => secrets.delete(profile.name),
  };
}

const LIVE = new AbortController().signal;
const NO_ROLES: InstanceReader = {
  query: async () => [],
  stats: () => {
    throw new Error("not used");
  },
};

function profile(name: string, url: string): InstanceProfile {
  return createProfile({
    name: InstanceName.parse(name),
    url,
    username: "admin",
    kind: "development",
    acknowledgeReadOnly: false,
  });
}

describe("instance profiles", () => {
  it("adds a profile and lists profiles by name", async () => {
    const profiles = memoryProfiles();
    await addInstance("/w", profile("test2", "dev2"), profiles);
    await addInstance("/w", profile("dev", "dev1"), profiles);
    expect((await listInstances("/w", profiles)).map((p) => String(p.name))).toEqual([
      "dev",
      "test2",
    ]);
  });

  it("refuses a second profile with the same name", async () => {
    const profiles = memoryProfiles();
    await addInstance("/w", profile("dev", "dev1"), profiles);
    await expect(addInstance("/w", profile("dev", "dev9"), profiles)).rejects.toMatchObject({
      code: "instance-exists",
    });
  });

  it("refuses a second profile for the same instance URL under another name", async () => {
    const profiles = memoryProfiles();
    await addInstance("/w", profile("dev", "dev1"), profiles);
    await expect(addInstance("/w", profile("alias", "dev1"), profiles)).rejects.toMatchObject({
      code: "instance-url-exists",
    });
  });

  it("removes a profile, and explains when there is none", async () => {
    const profiles = memoryProfiles();
    await addInstance("/w", profile("dev", "dev1"), profiles);
    await removeInstance("/w", InstanceName.parse("dev"), profiles);
    expect(profiles.saved.size).toBe(0);
    await expect(removeInstance("/w", InstanceName.parse("dev"), profiles)).rejects.toMatchObject({
      code: "instance-not-found",
    });
  });
});

describe("credentials", () => {
  it("stores, resolves and removes a secret for a profile", async () => {
    const credentials = memoryCredentials();
    const dev = profile("dev", "dev1");
    await login(dev, "s3cret", credentials, NO_ROLES, LIVE);
    expect(await resolveSecret(dev, credentials)).toBe("s3cret");
    expect(await logout(dev, credentials)).toBe(true);
  });

  it("refuses an empty secret", async () => {
    await expect(
      login(profile("dev", "dev1"), "", memoryCredentials(), NO_ROLES, LIVE),
    ).rejects.toMatchObject({
      code: "invalid-input",
    });
  });

  it("explains how to log in when no secret is stored", async () => {
    await expect(resolveSecret(profile("dev", "dev1"), memoryCredentials())).rejects.toMatchObject({
      code: "credentials-missing",
      hint: expect.stringMatching(
        /snagentic auth login dev.*SNAGENTIC_DEV_PASSWORD, SNAGENTIC_DEV_URL and SNAGENTIC_DEV_KIND/,
      ),
    });
  });
});
