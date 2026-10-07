import { describe, expect, it } from "bun:test";
import {
  createProfile,
  ensureDevelopmentInstance,
  type InstanceKind,
  InstanceName,
  type InstanceReader,
  type TableQuery,
  verifyReadOnlyCredential,
} from "@snagentic/core";

const LIVE = new AbortController().signal;
const profile = (kind: InstanceKind) =>
  createProfile({
    name: InstanceName.parse("prod"),
    url: "acme",
    username: "svc_snagentic",
    kind,
    acknowledgeReadOnly: kind !== "development",
  });

function reader(roles: string[]) {
  const queries: TableQuery[] = [];
  const fake: InstanceReader = {
    query: async (query) => {
      queries.push(query);
      return roles.includes("snc_read_only") ? [{ sys_id: "r1" }] : [];
    },
    stats: () => {
      throw new Error("not used");
    },
  };
  return { fake, queries };
}

describe("verifyReadOnlyCredential (ADR-0012 layer 4)", () => {
  it.each(["test", "production"] as const)(
    "lets a read-only credential use a %s instance",
    async (kind) => {
      const { fake, queries } = reader(["snc_read_only"]);
      await verifyReadOnlyCredential(profile(kind), fake, LIVE);
      // ADR-0021: the signed-in session, never the editable username in instance.yaml.
      expect(queries[0]?.query).toBe(
        "user=javascript:gs.getUserID()^state=active^role.name=snc_read_only",
      );
    },
  );

  it.each(["test", "production"] as const)(
    "refuses a %s instance whose credential could write",
    async (kind) => {
      const { fake } = reader(["admin"]);
      await expect(verifyReadOnlyCredential(profile(kind), fake, LIVE)).rejects.toMatchObject({
        code: "read-only-credential-required",
        category: "not-permitted",
      });
    },
  );

  it("does not ask a development instance anything", async () => {
    const { fake, queries } = reader([]);
    await verifyReadOnlyCredential(profile("development"), fake, LIVE);
    expect(queries).toEqual([]);
  });
});

describe("ensureDevelopmentInstance (ADR-0012 layer 3)", () => {
  it.each(["test", "production"] as const)("refuses to change a %s instance", (kind) => {
    expect(() => ensureDevelopmentInstance(profile(kind), "plugin activation")).toThrow(
      expect.objectContaining({ code: "development-instance-required" }),
    );
  });

  it("allows changing a development instance", () => {
    expect(() =>
      ensureDevelopmentInstance(profile("development"), "plugin activation"),
    ).not.toThrow();
  });
});
