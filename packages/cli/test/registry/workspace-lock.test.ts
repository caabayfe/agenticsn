import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { FileWorkspaceLock } from "../../src/adapters/state/file-workspace-lock";
import { describeError, executeUseCase } from "../../src/registry/execute";
import { USE_CASES } from "../../src/registry/registry";
import {
  defineUseCase,
  qualifiedName,
  type UseCase,
  type UseCaseContext,
} from "../../src/registry/use-case";
import { lockScope } from "../../src/registry/workspace-lock";
import { FAKE_CONTEXT } from "../support/fakes";

const ROOT = "/work/space";

function lockedContext(): UseCaseContext {
  const locks = mkdtempSync(join(tmpdir(), "execute-lock-"));
  return {
    ...FAKE_CONTEXT,
    host: { ...FAKE_CONTEXT.host, cwd: ROOT },
    workspaces: {
      ...FAKE_CONTEXT.workspaces,
      ancestorsOf: (directory) => [directory],
      readManifest: async (directory) =>
        directory === ROOT ? { layout: 2, createdWith: "test" } : null,
    },
    workspaceLock: (_root, instance) =>
      new FileWorkspaceLock(join(locks, instance ?? "_workspace")),
  };
}

// A write command that runs until the test lets it finish; without an instance input, it writes
// the workspace only.
function gatedUseCase(
  name: string,
  readOnly = false,
  inner?: () => Promise<unknown>,
  input: z.ZodObject = z.object({ instance: z.string() }),
) {
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let started = () => {};
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const useCase = defineUseCase({
    name,
    description: "A command that waits.",
    input,
    output: z.object({ done: z.boolean() }),
    flags: { readOnly, destructive: false, requiresDevelopmentInstance: false },
    mcp: false,
    async handle() {
      started();
      await inner?.();
      await gate;
      return { done: true };
    },
    render: () => "",
    exitCode: () => 0,
  });
  return { useCase: useCase as UseCase, open, running };
}

describe("the workspace lock taken by every write command (REL-03)", () => {
  it("refuses a second write command on the instance while the first runs, naming it", async () => {
    const context = lockedContext();
    const push = gatedUseCase("push");
    const pull = gatedUseCase("pull");
    const first = executeUseCase(push.useCase, { instance: "dev" }, context);
    await push.running;
    const refused = await executeUseCase(pull.useCase, { instance: "dev" }, context).catch(
      (error: unknown) => error,
    );
    expect(describeError(refused)).toMatchObject({ code: "workspace-locked", exitCode: 3 });
    expect(describeError(refused).message).toContain(`\`push\` (pid ${process.pid}`);
    push.open();
    await first;
    pull.open();
    expect((await executeUseCase(pull.useCase, { instance: "dev" }, context)).output).toEqual({
      done: true,
    });
  });

  it("lets write commands on two instances run at once", async () => {
    const context = lockedContext();
    const one = gatedUseCase("push");
    const two = gatedUseCase("push");
    const runs = [
      executeUseCase(one.useCase, { instance: "dev" }, context),
      executeUseCase(two.useCase, { instance: "sandbox" }, context),
    ];
    await Promise.all([one.running, two.running]);
    one.open();
    two.open();
    expect(await Promise.all(runs)).toHaveLength(2);
  });

  it("lets read-only commands run while a write command holds the lock", async () => {
    const context = lockedContext();
    const push = gatedUseCase("push");
    const status = gatedUseCase("status", true);
    const first = executeUseCase(push.useCase, { instance: "dev" }, context);
    await push.running;
    status.open();
    expect((await executeUseCase(status.useCase, { instance: "dev" }, context)).output).toEqual({
      done: true,
    });
    push.open();
    await first;
  });

  it("lets a command run the use cases it is made of under the lock it holds", async () => {
    const context = lockedContext();
    const pull = gatedUseCase("pull");
    pull.open();
    const install = gatedUseCase("install", false, () =>
      executeUseCase(pull.useCase, { instance: "dev" }, context),
    );
    install.open();
    expect((await executeUseCase(install.useCase, { instance: "dev" }, context)).output).toEqual({
      done: true,
    });
  });

  it("gives the lock back when the command fails", async () => {
    const context = lockedContext();
    const failing = defineUseCase({
      ...gatedUseCase("push").useCase,
      handle: async () => {
        throw new Error("instance unreachable");
      },
    });
    await expect(executeUseCase(failing, { instance: "dev" }, context)).rejects.toThrow(
      "instance unreachable",
    );
    const next = gatedUseCase("pull");
    next.open();
    expect((await executeUseCase(next.useCase, { instance: "dev" }, context)).output).toEqual({
      done: true,
    });
  });

  it("refuses a command that changes an instance's profile while another command holds it", async () => {
    const context = lockedContext();
    const push = gatedUseCase("push");
    const first = executeUseCase(push.useCase, { instance: "dev" }, context);
    await push.running;
    const remove = USE_CASES.find((u) => qualifiedName(u) === "instance remove");
    const refused = await executeUseCase(
      remove ?? push.useCase,
      { name: "dev", forgetCredentials: true },
      context,
    ).catch((error: unknown) => error);
    expect(describeError(refused)).toMatchObject({ code: "workspace-locked" });
    push.open();
    await first;
  });

  it("lets one command that writes the workspace but no instance run at a time", async () => {
    const context = lockedContext();
    const build = gatedUseCase("docs-build", false, undefined, z.object({}));
    const pin = gatedUseCase("docs-pin", false, undefined, z.object({}));
    const first = executeUseCase(build.useCase, {}, context);
    await build.running;
    const refused = await executeUseCase(pin.useCase, {}, context).catch((e: unknown) => e);
    expect(describeError(refused)).toMatchObject({ code: "workspace-locked" });
    expect(describeError(refused).hint).toContain(".snagentic/workspace.lock");
    build.open();
    await first;
  });

  it("lets a workspace command and an instance command run at once", async () => {
    const context = lockedContext();
    const build = gatedUseCase("docs-build", false, undefined, z.object({}));
    const push = gatedUseCase("push");
    const runs = [
      executeUseCase(build.useCase, {}, context),
      executeUseCase(push.useCase, { instance: "dev" }, context),
    ];
    await Promise.all([build.running, push.running]);
    build.open();
    push.open();
    expect(await Promise.all(runs)).toHaveLength(2);
  });

  it("runs a workspace step of an instance command under the instance's lock", async () => {
    const base = lockedContext();
    const taken: (string | null)[] = [];
    const context: UseCaseContext = {
      ...base,
      workspaceLock: (root, instance) => {
        taken.push(instance);
        return base.workspaceLock(root, instance);
      },
    };
    const keys = gatedUseCase("fluent-keys", false, undefined, z.object({}));
    keys.open();
    const install = gatedUseCase("install", false, () => executeUseCase(keys.useCase, {}, context));
    install.open();
    await executeUseCase(install.useCase, { instance: "dev" }, context);
    expect(taken).toEqual(["dev"]);
  });

  it("runs a workspace command outside any workspace without a lock", async () => {
    const context: UseCaseContext = {
      ...lockedContext(),
      host: { ...FAKE_CONTEXT.host, cwd: "/elsewhere" },
      workspaceLock: () => {
        throw new Error("no workspace to lock");
      },
    };
    const upgrade = gatedUseCase("upgrade", false, undefined, z.object({}));
    upgrade.open();
    expect((await executeUseCase(upgrade.useCase, {}, context)).output).toEqual({ done: true });
  });

  it("holds a lock for every command that is not read-only", () => {
    const scopes = Object.fromEntries(
      USE_CASES.flatMap((u) => {
        const scope = lockScope(u);
        if (scope === null) return [];
        return [
          [qualifiedName(u), typeof scope === "string" ? scope : `instance:${scope.instance}`],
        ];
      }),
    );
    expect(scopes).toEqual({
      "accelerator add": "instance:instance",
      "accelerator install": "instance:instance",
      "accelerator load": "instance:instance",
      adopt: "instance:instance",
      "agent install": "workspace",
      "apps install": "instance:instance",
      "auth login": "instance:instance",
      "auth logout": "instance:instance",
      "docs build": "workspace",
      "docs pin": "workspace",
      // Writes nothing itself: its build runs as `docs build`, under the workspace's lock.
      "docs serve": "none",
      "docs video": "workspace",
      "fluent-keys": "workspace",
      // Creates the workspace: there is none to lock yet.
      init: "none",
      "instance add": "instance:name",
      "instance remove": "instance:name",
      integrate: "instance:instance",
      // Like init it may create the workspace; the commands it runs take their own locks.
      onboard: "none",
      "plugins activate": "instance:instance",
      pull: "instance:instance",
      push: "instance:instance",
      "take-over": "instance:instance",
      upgrade: "workspace",
    });
  });

  it("names, for every command locking an instance, a string input that holds it", () => {
    for (const useCase of USE_CASES) {
      const scope = lockScope(useCase);
      if (scope === null || typeof scope === "string") continue;
      const field = useCase.input.shape[scope.instance];
      expect({ useCase: qualifiedName(useCase), takes: field?.safeParse("dev").success }).toEqual({
        useCase: qualifiedName(useCase),
        takes: true,
      });
    }
  });
});
