import { describe, expect, it } from "bun:test";
import {
  AuthenticationFailedError,
  type CredentialStore,
  createProfile,
  type InstanceKind,
  InstanceName,
  type InstanceReader,
  login,
  resolveSecret,
  type StoredCredential,
  trustedSecret,
} from "@snagentic/core";

const LIVE = new AbortController().signal;
const profile = (kind: InstanceKind, url = "acme") =>
  createProfile({
    name: InstanceName.parse("prod"),
    url,
    username: "svc",
    kind,
    acknowledgeReadOnly: kind !== "development",
  });
const PROD = profile("production");

function holding(credential: StoredCredential | null): CredentialStore {
  return {
    read: async () => credential,
    write: async () => {},
    remove: async () => false,
  };
}

const forProd = (source: StoredCredential["source"] = "keychain"): StoredCredential => ({
  secret: "pw",
  source,
  trusted: { url: PROD.url, kind: "production" },
});

describe("a secret is released only for the settings it was stored for (ADR-0020)", () => {
  it("releases the secret when url and kind match", async () => {
    expect(await resolveSecret(PROD, holding(forProd()))).toBe("pw");
    expect(trustedSecret(PROD, forProd())).toBe("pw");
  });

  it("refuses a profile whose kind was changed after login", async () => {
    const edited = profile("development");
    await expect(resolveSecret(edited, holding(forProd()))).rejects.toMatchObject({
      code: "profile-not-trusted",
      category: "not-permitted",
      message: expect.stringContaining(
        "kind is development, but was production when the password was stored",
      ),
      hint: expect.stringContaining("snagentic auth login prod"),
    });
    expect(trustedSecret(edited, forProd())).toBeNull();
  });

  it("refuses a profile whose url was changed after login", async () => {
    await expect(
      resolveSecret(profile("production", "evil"), holding(forProd())),
    ).rejects.toMatchObject({
      message: expect.stringContaining("url is https://evil.service-now.com"),
    });
  });

  it("refuses a secret stored by an earlier version, without the settings it is for", async () => {
    await expect(
      resolveSecret(PROD, holding({ secret: "pw", source: "keychain", trusted: null })),
    ).rejects.toMatchObject({
      code: "profile-not-trusted",
      hint: expect.stringContaining("snagentic auth login prod"),
    });
  });

  it("tells a CI job which variables pin an environment secret", async () => {
    await expect(
      resolveSecret(PROD, holding({ secret: "pw", source: "environment", trusted: null })),
    ).rejects.toMatchObject({
      hint: expect.stringContaining("SNAGENTIC_PROD_URL and SNAGENTIC_PROD_KIND"),
    });
  });
});

// The signed-in user is `session`; the profile's username is "svc".
function instance(roles: string[] | Error, session = "svc") {
  const reader: InstanceReader = {
    query: async (query) => {
      if (roles instanceof Error) {
        throw roles;
      }
      if (query.table === "sys_user") {
        return session === "" ? [] : [{ user_name: session }];
      }
      return roles.includes("snc_read_only") ? [{ sys_id: "r1" }] : [];
    },
    stats: () => {
      throw new Error("not used");
    },
  };
  return reader;
}

function recording() {
  const stored: string[] = [];
  const store: CredentialStore = {
    read: async () => null,
    write: async (_profile, secret) => {
      stored.push(secret);
    },
    remove: async () => false,
  };
  return { store, stored };
}

describe("login stores nothing unless the typed password works and matches the kind", () => {
  it("stores a read-only credential for a production instance", async () => {
    const { store, stored } = recording();
    await login(PROD, "pw", store, instance(["snc_read_only"]), LIVE);
    expect(stored).toEqual(["pw"]);
  });

  it("refuses a read-only credential for a profile that says development", async () => {
    const { store, stored } = recording();
    await expect(
      login(profile("development"), "pw", store, instance(["snc_read_only"]), LIVE),
    ).rejects.toMatchObject({ code: "read-only-credential-on-development" });
    expect(stored).toEqual([]);
  });

  it("refuses a credential that can write for a production instance", async () => {
    const { store, stored } = recording();
    await expect(login(PROD, "pw", store, instance(["admin"]), LIVE)).rejects.toMatchObject({
      code: "read-only-credential-required",
    });
    expect(stored).toEqual([]);
  });

  it("refuses a password the instance rejects", async () => {
    const { store, stored } = recording();
    await expect(
      login(PROD, "bad", store, instance(new AuthenticationFailedError("prod")), LIVE),
    ).rejects.toMatchObject({ code: "authentication-failed" });
    expect(stored).toEqual([]);
  });

  it("refuses when the instance signs in a different user than instance.yaml names", async () => {
    const { store, stored } = recording();
    await expect(
      login(PROD, "pw", store, instance(["snc_read_only"], "oauth_app_user"), LIVE),
    ).rejects.toMatchObject({
      code: "identity-mismatch",
      category: "not-permitted",
      message: expect.stringContaining("signed in as oauth_app_user"),
      hint: expect.stringContaining("instances/prod/instance.yaml"),
    });
    expect(stored).toEqual([]);
  });

  it("refuses when the signed-in user cannot be read", async () => {
    const { store, stored } = recording();
    await expect(
      login(PROD, "pw", store, instance(["snc_read_only"], ""), LIVE),
    ).rejects.toMatchObject({ code: "identity-unverified" });
    expect(stored).toEqual([]);
  });
});
