import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { executeUseCase } from "../../src/registry/execute";
import { pull } from "../../src/registry/pull";
import { USE_CASES } from "../../src/registry/registry";
import { updateSetsList } from "../../src/registry/update-sets-list";
import { defineUseCase } from "../../src/registry/use-case";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function workspace(kind: "development" | "test" | "production", roles: string[] = []) {
  const ws = await instanceWorkspace(
    {
      sys_user_has_role: roles.map((role, i) => ({
        sys_id: `r${i}`,
        "user.user_name": "admin",
        state: "active",
        "role.name": role,
      })),
    },
    kind,
  );
  cleanups.push(ws.cleanup);
  return ws;
}

let handled = 0;
const change = defineUseCase({
  group: "thing",
  name: "change",
  description: "changes the instance",
  input: z.object({ instance: z.string() }),
  output: z.object({}),
  flags: { readOnly: false, destructive: true, requiresDevelopmentInstance: true },
  mcp: false,
  async handle() {
    handled += 1;
    return {};
  },
  render: () => "",
  exitCode: () => 0,
});

describe("ADR-0012 layer 3: changing an instance", () => {
  it.each(["test", "production"] as const)(
    "never reaches the handler for a %s instance",
    async (kind) => {
      const { context } = await workspace(kind, ["snc_read_only"]);
      handled = 0;
      await expect(executeUseCase(change, { instance: "pdi" }, context)).rejects.toMatchObject({
        code: "development-instance-required",
      });
      expect(handled).toBe(0);
    },
  );

  it("runs for a development instance", async () => {
    const { context } = await workspace("development");
    handled = 0;
    await executeUseCase(change, { instance: "pdi" }, context);
    expect(handled).toBe(1);
  });

  it("is declared only by use cases that name their instance", () => {
    for (const useCase of USE_CASES.filter(
      (candidate) => candidate.flags.requiresDevelopmentInstance,
    )) {
      expect(Object.keys(useCase.input.shape)).toContain("instance");
    }
  });
});

describe("ADR-0012 layer 4: reading a test or production instance", () => {
  it.each([
    ["pull", pull],
    ["update-sets list", updateSetsList],
  ] as const)(
    "%s refuses a credential that could write, before asking anything else",
    async (_name, useCase) => {
      const { context, instance } = await workspace("production", ["admin"]);
      await expect(executeUseCase(useCase, { instance: "pdi" }, context)).rejects.toMatchObject({
        code: "read-only-credential-required",
      });
      expect(instance.queries.map((query) => String(query.table))).toEqual(["sys_user_has_role"]);
      expect(instance.fingerprints).toEqual([]);
    },
  );

  it("goes ahead with a read-only credential", async () => {
    const { context, instance } = await workspace("production", ["snc_read_only"]);
    await executeUseCase(updateSetsList, { instance: "pdi" }, context);
    expect(instance.queries.map((query) => String(query.table))).toContain("sys_update_set");
  });
});
