import { describe, expect, it } from "bun:test";
import {
  type CredentialStore,
  createProfile,
  type InstanceKind,
  InstanceName,
  type InstanceReader,
  login,
  resolveAccess,
  type StoredCredential,
} from "@snagentic/core";

const LIVE = new AbortController().signal;
const profile = (kind: InstanceKind = "development", clientId?: string) =>
  createProfile({
    name: InstanceName.parse("dev"),
    url: "acme",
    username: "admin",
    kind,
    acknowledgeReadOnly: kind !== "development",
    ...(clientId === undefined ? {} : { clientId }),
  });
const DEV = profile();

// The signed-in user is "admin"; `roles` are the roles it holds.
function instance(roles: readonly string[]): InstanceReader {
  return {
    query: async (query) => {
      if (query.table === "sys_user") {
        return [{ user_name: "admin" }];
      }
      const role = /role\.name=([a-z_]+)/.exec(query.query)?.[1] ?? "";
      return roles.includes(role) ? [{ sys_id: "r1" }] : [];
    },
    stats: () => {
      throw new Error("not used");
    },
  };
}

function recording() {
  const stored: { secret: string; elevation: boolean }[] = [];
  const store: CredentialStore = {
    read: async () => null,
    write: async (_profile, secret, options) => {
      stored.push({ secret, elevation: options?.elevation ?? false });
    },
    remove: async () => false,
  };
  return { store, stored };
}

const holding = (credential: StoredCredential): CredentialStore => ({
  read: async () => credential,
  write: async () => {},
  remove: async () => false,
});

describe("a person opts an instance into elevated writes at login (ADR-0024)", () => {
  it("records the opt-in with the secret when the user holds security_admin", async () => {
    const { store, stored } = recording();
    await login(DEV, "pw", store, instance(["security_admin"]), LIVE, { allowElevation: true });
    expect(stored).toEqual([{ secret: "pw", elevation: true }]);
  });

  it("stores no opt-in unless it is asked for", async () => {
    const { store, stored } = recording();
    await login(DEV, "pw", store, instance(["security_admin"]), LIVE);
    expect(stored).toEqual([{ secret: "pw", elevation: false }]);
  });

  it("refuses the opt-in when the user does not hold security_admin, storing nothing", async () => {
    const { store, stored } = recording();
    await expect(
      login(DEV, "pw", store, instance([]), LIVE, { allowElevation: true }),
    ).rejects.toMatchObject({
      code: "security-admin-required",
      category: "precondition",
      message: expect.stringContaining("admin does not hold security_admin"),
    });
    expect(stored).toEqual([]);
  });

  it("refuses the opt-in for test and production instances", async () => {
    const { store, stored } = recording();
    const prod = profile("production");
    await expect(
      login(prod, "pw", store, instance(["snc_read_only"]), LIVE, { allowElevation: true }),
    ).rejects.toMatchObject({ code: "development-instance-required" });
    expect(stored).toEqual([]);
  });

  it("refuses the opt-in for an OAuth client, which cannot sign in to the login form", async () => {
    const { store, stored } = recording();
    await expect(
      login(profile("development", "client1"), "pw", store, instance(["security_admin"]), LIVE, {
        allowElevation: true,
      }),
    ).rejects.toMatchObject({
      code: "elevation-unsupported",
      hint: expect.stringContaining("Basic"),
    });
    expect(stored).toEqual([]);
  });
});

describe("elevated writes are allowed only while the opt-in still matches the profile", () => {
  const trusted = (elevation?: boolean): StoredCredential => ({
    secret: "pw",
    source: "keychain",
    trusted: {
      url: DEV.url,
      kind: "development",
      ...(elevation === undefined ? {} : { elevation }),
    },
  });

  it("allows elevation for a development profile that was opted in", async () => {
    expect(await resolveAccess(DEV, holding(trusted(true)))).toEqual({
      secret: "pw",
      elevation: true,
    });
  });

  it("does not allow elevation for a credential stored without the opt-in", async () => {
    expect(await resolveAccess(DEV, holding(trusted()))).toEqual({
      secret: "pw",
      elevation: false,
    });
    expect(await resolveAccess(DEV, holding(trusted(false)))).toEqual({
      secret: "pw",
      elevation: false,
    });
  });
});
