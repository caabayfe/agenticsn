import { describe, expect, it } from "bun:test";
import {
  type LockHolder,
  type WorkspaceLock,
  WorkspaceLockedError,
  withWorkspaceLock,
} from "../../src/index";

function memoryLock(): WorkspaceLock & { holder: LockHolder | null } {
  const state = {
    holder: null as LockHolder | null,
    async acquire(command: string, started: string) {
      if (state.holder !== null) return { acquired: false as const, holder: state.holder };
      state.holder = { command, pid: 42, host: "laptop", started };
      return { acquired: true as const };
    },
    async release() {
      state.holder = null;
    },
  };
  return state;
}

const claim = (command: string) => ({ instance: "dev", command, started: "2026-11-10T09:00:00Z" });

describe("withWorkspaceLock", () => {
  it("refuses a second command while the first holds the lock, naming the holder", async () => {
    const lock = memoryLock();
    let finish = () => {};
    const first = withWorkspaceLock(
      lock,
      claim("push"),
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const second = withWorkspaceLock(lock, claim("pull"), async () => "ran");
    const refused = await second.catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(WorkspaceLockedError);
    const message = String(Reflect.get(Object(refused), "message"));
    expect(message).toContain("`push` (pid 42 on laptop, started 2026-11-10T09:00:00Z)");
    expect(String(Reflect.get(Object(refused), "hint"))).toContain(".snagentic/dev/workspace.lock");
    finish();
    await first;
    expect(await withWorkspaceLock(lock, claim("pull"), async () => "ran")).toBe("ran");
  });

  it("gives the lock back when the work fails", async () => {
    const lock = memoryLock();
    await expect(
      withWorkspaceLock(lock, claim("push"), async () => {
        throw new Error("instance unreachable");
      }),
    ).rejects.toThrow("instance unreachable");
    expect(lock.holder).toBeNull();
  });

  it("names no holder it cannot read", () => {
    expect(new WorkspaceLockedError("dev", null).message).toBe(
      "another snagentic command is changing dev in this workspace",
    );
  });
});
