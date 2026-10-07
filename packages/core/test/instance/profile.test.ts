import { describe, expect, it } from "bun:test";
import {
  canWrite,
  createProfile,
  credentialAccount,
  InstanceName,
  normalizeInstanceUrl,
  secretName,
} from "@snagentic/core";

describe("normalizeInstanceUrl", () => {
  it.each([
    ["dev312411", "https://dev312411.service-now.com"],
    ["dev312411.service-now.com", "https://dev312411.service-now.com"],
    ["https://dev312411.service-now.com/", "https://dev312411.service-now.com"],
    ["HTTPS://Acme.ServiceNowServices.com", "https://acme.servicenowservices.com"],
    ["https://servicenow.acme.example:8443", "https://servicenow.acme.example:8443"],
  ])("normalizes %p to %p", (input, expected) => {
    expect(normalizeInstanceUrl(input)).toBe(expected);
  });

  it.each([
    "http://dev1.service-now.com",
    "https://dev1.service-now.com/now/nav",
    "ftp://x",
    "",
    "a b",
  ])("rejects %p (https origin only)", (input) => {
    expect(() => normalizeInstanceUrl(input)).toThrow(/instance URL/);
  });
});

describe("createProfile", () => {
  const base = {
    name: InstanceName.parse("pdi"),
    url: "dev312411",
    username: "admin",
  };

  it("creates a development profile with basic authentication", () => {
    expect(createProfile({ ...base, kind: "development", acknowledgeReadOnly: false })).toEqual({
      name: InstanceName.parse("pdi"),
      url: "https://dev312411.service-now.com",
      kind: "development",
      auth: { method: "basic", username: "admin" },
      readOnlyAcknowledged: false,
    });
  });

  it.each(["test", "production"] as const)(
    "requires an explicit read-only acknowledgement for a %s instance",
    (kind) => {
      expect(() => createProfile({ ...base, kind, acknowledgeReadOnly: false })).toThrow(
        expect.objectContaining({ code: "read-only-acknowledgement-required" }),
      );
      expect(createProfile({ ...base, kind, acknowledgeReadOnly: true }).readOnlyAcknowledged).toBe(
        true,
      );
    },
  );

  it.each(["admin^ORuser_name=x", "a,b", "line\nbreak"])(
    "rejects the username %p, which could alter encoded queries",
    (username) => {
      expect(() =>
        createProfile({ ...base, username, kind: "development", acknowledgeReadOnly: false }),
      ).toThrow(expect.objectContaining({ code: "invalid-input" }));
    },
  );

  it("creates an OAuth client-credentials profile when a client id is given (ADR-0021)", () => {
    const profile = createProfile({
      ...base,
      username: "svc_oauth",
      clientId: " 0123abcd ",
      kind: "development",
      acknowledgeReadOnly: false,
    });
    expect(profile.auth).toEqual({
      method: "oauth-client-credentials",
      clientId: "0123abcd",
      username: "svc_oauth",
    });
  });

  it.each(["", "a b", "id@host", "a:b", "a^b"])("rejects the client id %p", (clientId) => {
    expect(() =>
      createProfile({ ...base, clientId, kind: "development", acknowledgeReadOnly: false }),
    ).toThrow(expect.objectContaining({ code: "invalid-input" }));
  });

  it("rejects an empty username", () => {
    expect(() =>
      createProfile({ ...base, username: " ", kind: "development", acknowledgeReadOnly: false }),
    ).toThrow(expect.objectContaining({ code: "invalid-input" }));
  });
});

describe("write policy and credential naming", () => {
  const profile = createProfile({
    name: InstanceName.parse("pdi"),
    url: "dev312411",
    username: "admin",
    kind: "development",
    acknowledgeReadOnly: false,
  });

  it("allows writes only to development instances", () => {
    expect(canWrite(profile)).toBe(true);
    expect(canWrite({ ...profile, kind: "test" })).toBe(false);
    expect(canWrite({ ...profile, kind: "production" })).toBe(false);
  });

  it("names the keychain account <username>@<host>", () => {
    expect(credentialAccount(profile)).toBe("admin@dev312411.service-now.com");
    expect(secretName(profile)).toBe("password");
  });

  it("names an OAuth client's account apart from any user, so a switched method finds nothing", () => {
    const client = createProfile({
      name: InstanceName.parse("pdi"),
      url: "dev312411",
      username: "admin",
      clientId: "admin",
      kind: "development",
      acknowledgeReadOnly: false,
    });
    expect(credentialAccount(client)).toBe("oauth:admin@dev312411.service-now.com");
    expect(secretName(client)).toBe("client secret");
  });
});
