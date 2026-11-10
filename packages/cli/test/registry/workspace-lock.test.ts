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
import { locksWorkspace } from "../../src/registry/workspace-lock";
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
    workspaceLock: (_root, instance) => new FileWorkspaceLock(join(locks, instance)),
  };
}

// A write command that runs until the test lets it finish.
function gatedUseCase(name: string, readOnly = false, inner?: () => Promise<unknown>) {
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
    input: z.object({ instance: z.string() }),
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

  it("is taken by every command that writes a mirror, a workspace branch or an instance", () => {
    const locking = USE_CASES.filter(locksWorkspace).map(qualifiedName).sort();
    expect(locking).toEqual([
      "accelerator add",
      "accelerator install",
      "accelerator load",
      "adopt",
      "apps install",
      "integrate",
      "plugins activate",
      "pull",
      "push",
      "take-over",
    ]);
  });
});
