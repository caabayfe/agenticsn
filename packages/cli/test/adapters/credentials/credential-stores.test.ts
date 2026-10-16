import { describe, expect, it } from "bun:test";
import { createProfile, InstanceName } from "@snagentic/core";
import { EnvironmentCredentialStore } from "../../../src/adapters/credentials/environment-credential-store";
import {
  KeychainCredentialStore,
  type KeychainEntry,
} from "../../../src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../../src/adapters/credentials/layered-credential-store";

const profile = createProfile({
  name: InstanceName.parse("acme-prod"),
  url: "acme",
  username: "integration",
  kind: "production",
  acknowledgeReadOnly: true,
});

const oauthProfile = createProfile({
  name: InstanceName.parse("acme-prod"),
  url: "acme",
  username: "integration",
  clientId: "abc123",
  kind: "production",
  acknowledgeReadOnly: true,
});

function memoryKeychain() {
  const entries = new Map<string, string>();
  const opened: string[] = [];
  const factory = (service: string, account: string): KeychainEntry => {
    opened.push(`${service}/${account}`);
    const key = `${service}/${account}`;
    return {
      getPassword: async () => entries.get(key),
      setPassword: async (password) => {
        entries.set(key, password);
      },
      deletePassword: async () => entries.delete(key),
    };
  };
  return { entries, opened, factory };
}

describe("KeychainCredentialStore", () => {
  it("stores the secret with the url and kind it is for, under account <user>@<host>", async () => {
    const keychain = memoryKeychain();
    const store = new KeychainCredentialStore(keychain.factory);
    await store.write(profile, "pw");
    expect(keychain.opened).toEqual(["snagentic/integration@acme.service-now.com"]);
    expect(await store.read(profile)).toEqual({
      secret: "pw",
      source: "keychain",
      trusted: { url: "https://acme.service-now.com", kind: "production" },
    });
    expect(
      JSON.parse(keychain.entries.get("snagentic/integration@acme.service-now.com") ?? ""),
    ).toEqual({
      snagentic: 1,
      secret: "pw",
      url: "https://acme.service-now.com",
      kind: "production",
    });
    expect(await store.remove(profile)).toBe(true);
    expect(await store.read(profile)).toBeNull();
  });

  it("reads a secret stored by an earlier version as not bound to any instance", async () => {
    const keychain = memoryKeychain();
    keychain.entries.set("snagentic/integration@acme.service-now.com", "old-pw");
    expect(await new KeychainCredentialStore(keychain.factory).read(profile)).toEqual({
      secret: "old-pw",
      source: "keychain",
      trusted: null,
    });
  });

  it("reads nothing when the keychain is unavailable, so CI can fall back to variables", async () => {
    const store = new KeychainCredentialStore(() => {
      throw new Error("no Secret Service");
    });
    expect(await store.read(profile)).toBeNull();
  });

  it("explains how to proceed when the keychain cannot store a secret", async () => {
    const store = new KeychainCredentialStore(() => {
      throw new Error("no Secret Service");
    });
    await expect(store.write(profile, "pw")).rejects.toMatchObject({
      code: "keychain-unavailable",
      hint: expect.stringContaining(
        "SNAGENTIC_ACME_PROD_PASSWORD, SNAGENTIC_ACME_PROD_URL and SNAGENTIC_ACME_PROD_KIND",
      ),
    });
  });

  it("uses the real OS keychain: works on macOS and Windows, may be unavailable on Linux", async () => {
    const store = new KeychainCredentialStore();
    const probe = createProfile({
      ...profile,
      name: InstanceName.parse("probe"),
      url: "probe-test",
      username: `test-${crypto.randomUUID()}`,
      kind: "development",
      acknowledgeReadOnly: false,
    });
    const stored = await store.write(probe, "probe-secret").then(
      () => true,
      () => false,
    );
    if (stored) {
      expect((await store.read(probe))?.secret).toBe("probe-secret");
      expect(await store.remove(probe)).toBe(true);
    } else {
      expect(process.platform).toBe("linux");
    }
  });
});

const PINNED = {
  SNAGENTIC_ACME_PROD_PASSWORD: "from-ci",
  SNAGENTIC_ACME_PROD_URL: "acme",
  SNAGENTIC_ACME_PROD_KIND: "production",
};

describe("EnvironmentCredentialStore", () => {
  it("reads SNAGENTIC_<NAME>_PASSWORD, pinned by SNAGENTIC_<NAME>_URL and _KIND", async () => {
    expect(await new EnvironmentCredentialStore(PINNED).read(profile)).toEqual({
      secret: "from-ci",
      source: "environment",
      trusted: { url: "https://acme.service-now.com", kind: "production" },
    });
    expect(await new EnvironmentCredentialStore({}).read(profile)).toBeNull();
  });

  it("binds the secret to nothing when the pinning variables are missing or invalid", async () => {
    for (const environment of [
      { SNAGENTIC_ACME_PROD_PASSWORD: "from-ci" },
      { ...PINNED, SNAGENTIC_ACME_PROD_KIND: "staging" },
      { ...PINNED, SNAGENTIC_ACME_PROD_URL: "http://" },
    ]) {
      expect((await new EnvironmentCredentialStore(environment).read(profile))?.trusted).toBeNull();
    }
  });
});

describe("credential stores with an OAuth client", () => {
  it("keeps the client secret under account oauth:<client id>@<host>, apart from any password", async () => {
    const keychain = memoryKeychain();
    const store = new KeychainCredentialStore(keychain.factory);
    await store.write(oauthProfile, "client-secret");
    expect(keychain.opened).toEqual(["snagentic/oauth:abc123@acme.service-now.com"]);
    expect(await store.read(profile)).toBeNull();
    expect((await store.read(oauthProfile))?.secret).toBe("client-secret");
  });

  it("reads the client secret from SNAGENTIC_<NAME>_PASSWORD in CI", async () => {
    expect((await new EnvironmentCredentialStore(PINNED).read(oauthProfile))?.secret).toBe(
      "from-ci",
    );
  });
});

describe("EnvironmentCredentialStore is read-only", () => {
  it("refuses to store a secret and never removes one", async () => {
    const store = new EnvironmentCredentialStore({ SNAGENTIC_ACME_PROD_PASSWORD: "from-ci" });
    await expect(store.write()).rejects.toThrow(/read-only/);
    expect(await store.remove()).toBe(false);
    expect((await store.read(profile))?.secret).toBe("from-ci");
  });
});

describe("LayeredCredentialStore", () => {
  it("prefers the environment variable, then the keychain, and writes to the keychain", async () => {
    const keychain = memoryKeychain();
    const persistent = new KeychainCredentialStore(keychain.factory);
    const withVariable = new LayeredCredentialStore(
      new EnvironmentCredentialStore({ SNAGENTIC_ACME_PROD_PASSWORD: "from-ci" }),
      persistent,
    );
    await withVariable.write(profile, "from-keychain");
    expect((await withVariable.read(profile))?.secret).toBe("from-ci");
    const withoutVariable = new LayeredCredentialStore(
      new EnvironmentCredentialStore({}),
      persistent,
    );
    expect((await withoutVariable.read(profile))?.secret).toBe("from-keychain");
    expect(await withoutVariable.remove(profile)).toBe(true);
  });
});
