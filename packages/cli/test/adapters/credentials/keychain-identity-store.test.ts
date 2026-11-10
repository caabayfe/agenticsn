import { describe, expect, it } from "bun:test";
import {
  createProfile,
  InstanceName,
  resolveSecret,
  resolveUsername,
  withUsername,
} from "@snagentic/core";
import {
  KeychainCredentialStore,
  type KeychainEntry,
} from "../../../src/adapters/credentials/keychain-credential-store";
import { KeychainIdentityStore } from "../../../src/adapters/credentials/keychain-identity-store";

const ROOT = "/work/acme";

const profile = createProfile({
  name: InstanceName.parse("acme-dev"),
  url: "acme",
  username: "puller",
  kind: "development",
  acknowledgeReadOnly: false,
});

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

const ACCOUNT = "snagentic/identity:acme-dev@acme.service-now.com:/work/acme";

describe("KeychainIdentityStore (ADR-0054)", () => {
  it("stores this clone's identity with the url and kind, under one account per clone and instance", async () => {
    const keychain = memoryKeychain();
    const store = new KeychainIdentityStore(keychain.factory);
    await store.write(ROOT, profile, "jdoe");
    expect(JSON.parse(keychain.entries.get(ACCOUNT) ?? "")).toEqual({
      snagentic: 1,
      identity: "jdoe",
      url: "https://acme.service-now.com",
      kind: "development",
    });
    expect(await store.read(ROOT, profile)).toBe("jdoe");
    expect(await store.read("/work/other-clone", profile)).toBeNull();
  });

  it("ignores the identity once the profile names another url or kind", async () => {
    const keychain = memoryKeychain();
    const store = new KeychainIdentityStore(keychain.factory);
    await store.write(ROOT, profile, "jdoe");
    expect(await store.read(ROOT, { ...profile, kind: "production" })).toBeNull();
    const item = JSON.parse(keychain.entries.get(ACCOUNT) ?? "");
    keychain.entries.set(ACCOUNT, JSON.stringify({ ...item, url: "https://evil.service-now.com" }));
    expect(await store.read(ROOT, profile)).toBeNull();
  });

  it("ignores an item it can't read, or a username queries can't carry", async () => {
    const keychain = memoryKeychain();
    const store = new KeychainIdentityStore(keychain.factory);
    keychain.entries.set(ACCOUNT, "jdoe");
    expect(await store.read(ROOT, profile)).toBeNull();
    keychain.entries.set(
      ACCOUNT,
      JSON.stringify({
        snagentic: 1,
        identity: "a^b",
        url: "https://acme.service-now.com",
        kind: "development",
      }),
    );
    expect(await store.read(ROOT, profile)).toBeNull();
  });

  it("removes the identity, and reads nothing when the keychain is unavailable", async () => {
    const keychain = memoryKeychain();
    const store = new KeychainIdentityStore(keychain.factory);
    await store.write(ROOT, profile, "jdoe");
    expect(await store.remove(ROOT, profile)).toBe(true);
    expect(await store.read(ROOT, profile)).toBeNull();
    const broken = new KeychainIdentityStore(() => {
      throw new Error("no keychain");
    });
    expect(await broken.read(ROOT, profile)).toBeNull();
    expect(await broken.remove(ROOT, profile)).toBe(false);
    await expect(broken.write(ROOT, profile, "jdoe")).rejects.toMatchObject({
      code: "keychain-unavailable",
    });
  });

  it("uses the real OS keychain: works on macOS and Windows, may be unavailable on Linux", async () => {
    const store = new KeychainIdentityStore();
    const root = `/test/${crypto.randomUUID()}`;
    const stored = await store.write(root, profile, "probe").then(
      () => true,
      () => false,
    );
    if (stored) {
      expect(await store.read(root, profile)).toBe("probe");
      expect(await store.remove(root, profile)).toBe(true);
    } else {
      expect(process.platform).toBe("linux");
    }
  });

  it("never releases another person's secret: a changed identity finds only its own item", async () => {
    const keychain = memoryKeychain();
    const secrets = new KeychainCredentialStore(keychain.factory);
    const identities = new KeychainIdentityStore(keychain.factory);
    const sources = { environment: {}, clone: identities };
    await secrets.write(withUsername(profile, "alice", "clone"), "alice-secret");
    await identities.write(ROOT, profile, "alice");
    const asAlice = await resolveUsername(ROOT, profile, sources);
    expect(await resolveSecret(asAlice, secrets)).toBe("alice-secret");
    await identities.write(ROOT, profile, "mallory");
    const asMallory = await resolveUsername(ROOT, profile, sources);
    expect(asMallory.auth.username).toBe("mallory");
    await expect(resolveSecret(asMallory, secrets)).rejects.toMatchObject({
      code: "credentials-missing",
    });
    const fromVariable = {
      environment: { SNAGENTIC_ACME_DEV_USERNAME: "mallory" },
      clone: identities,
    };
    await identities.write(ROOT, profile, "alice");
    await expect(
      resolveSecret(await resolveUsername(ROOT, profile, fromVariable), secrets),
    ).rejects.toMatchObject({ code: "credentials-missing" });
  });
});
