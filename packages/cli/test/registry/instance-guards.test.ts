import { afterEach, describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DevelopmentProfile, InstanceProfile } from "@snagentic/core";
import { z } from "zod";
import { connectForWrite } from "../../src/registry/connect";
import { executeUseCase } from "../../src/registry/execute";
import { callerFor } from "../../src/registry/install-steps";
import { pull } from "../../src/registry/pull";
import { USE_CASES } from "../../src/registry/registry";
import { updateSetsList } from "../../src/registry/update-sets-list";
import {
  type ConnectionFactory,
  defineUseCase,
  type ReadConnection,
  type UseCase,
  type WriteConnection,
} from "../../src/registry/use-case";
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
        user: "u1",
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

const reachesForWrite = defineUseCase({
  group: "thing",
  name: "reach",
  description: "asks for a write connection",
  input: z.object({ instance: z.string() }),
  output: z.object({}),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(input, context, run) {
    await connectForWrite(context, input.instance, run.signal);
    handled += 1;
    return {};
  },
  render: () => "",
  exitCode: () => 0,
});

describe("ADR-0012 layer 3: one write gate", () => {
  it.each(["test", "production"] as const)(
    "refuses a nested use case that changes a %s instance",
    async (kind) => {
      const { context } = await workspace(kind, ["snc_read_only"]);
      handled = 0;
      const run = { signal: new AbortController().signal, progress: () => {} };
      await expect(callerFor(context, run)(change, { instance: "pdi" })).rejects.toMatchObject({
        code: "development-instance-required",
      });
      expect(handled).toBe(0);
    },
  );

  it("withholds the write connection from a use case not declared as changing an instance", async () => {
    const { context } = await workspace("development");
    handled = 0;
    await expect(executeUseCase(reachesForWrite, { instance: "pdi" }, context)).rejects.toThrow(
      "not declared as changing an instance",
    );
    expect(handled).toBe(0);
  });

  // The composition root's factory is a class (InstanceConnections, ADR-0053): withholding the
  // write connection must keep the read one, whose method lives on the prototype.
  it("keeps the read connection of a factory whose methods are on its class", async () => {
    const { context, instance } = await workspace("development");
    class Connections implements ConnectionFactory {
      open(profile: InstanceProfile, secret: string): ReadConnection {
        return context.connections.open(profile, secret);
      }
      openForWrite(profile: DevelopmentProfile, secret: string): WriteConnection {
        return context.connections.openForWrite(profile, secret);
      }
    }
    const classBased = { ...context, connections: new Connections() };
    await executeUseCase(updateSetsList, { instance: "pdi" }, classBased);
    expect(instance.queries.map((query) => String(query.table))).toContain("sys_update_set");
  });

  it("gives the write connection to a use case declared as changing a development instance", async () => {
    const { context } = await workspace("development");
    handled = 0;
    const declared = { ...reachesForWrite, flags: { ...change.flags } };
    await executeUseCase(declared, { instance: "pdi" }, context);
    expect(handled).toBe(1);
  });

  it("never declares a read-only use case as changing an instance", () => {
    const both = USE_CASES.filter((u) => u.flags.readOnly && u.flags.requiresDevelopmentInstance);
    expect(both.map((u) => u.name)).toEqual([]);
  });

  it("never lets a read-only use case ask for a write connection", async () => {
    // The gate above withholds write ports at run time; this catches a mislabelled use case
    // before any run, along every registry module it reaches.
    const reaching = await readOnlyReachingWrites(
      USE_CASES.filter((useCase) => useCase.flags.readOnly),
    );
    expect(reaching).toEqual([]);
  });
});

const REGISTRY = join(import.meta.dir, "../../src/registry");
const ASKS_FOR_WRITE = /(?:\bconnectForWrite|\.openForWrite)\(/;

// The registry modules a module reaches through its relative imports, itself included.
async function reached(file: string, seen = new Set<string>()): Promise<Set<string>> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = await readFile(join(REGISTRY, file), "utf8");
  for (const [, name] of text.matchAll(/from "\.\/([a-z0-9-]+)"/g)) {
    await reached(`${name}.ts`, seen);
  }
  return seen;
}

// Each read-only use case, by the module that defines it, with the modules it reaches that
// ask for a write connection.
async function readOnlyReachingWrites(useCases: readonly UseCase[]): Promise<string[]> {
  const found: string[] = [];
  const files = (await readdir(REGISTRY)).filter((f) => f.endsWith(".ts") && f !== "connect.ts");
  for (const file of files) {
    const module: Record<string, unknown> = await import(join(REGISTRY, file));
    if (!Object.values(module).some((value) => useCases.some((u) => u === value))) continue;
    for (const dependency of await reached(file)) {
      if (dependency === "connect.ts") continue;
      const text = await readFile(join(REGISTRY, dependency), "utf8");
      if (ASKS_FOR_WRITE.test(text)) found.push(`${file} reaches ${dependency}`);
    }
  }
  return found;
}
