import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { FileWorkspaceLock, setAsideStale } from "../../../src/adapters/state/file-workspace-lock";

const directory = () => join(mkdtempSync(join(tmpdir(), "workspace-lock-")), "pdi");
const STARTED = "2026-11-10T09:00:00.000Z";

async function endedPid(): Promise<number> {
  const ended = Bun.spawn(["true"]);
  await ended.exited;
  return ended.pid;
}

function writeLock(at: string, holder: Record<string, unknown>): void {
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "workspace.lock"), JSON.stringify(holder));
}

describe("the workspace lock file (REL-03)", () => {
  it("lets one command hold an instance at a time, and names it to the next", async () => {
    const at = directory();
    const first = new FileWorkspaceLock(at);
    const second = new FileWorkspaceLock(at);
    expect(await first.acquire("push", STARTED)).toEqual({ acquired: true });
    expect(await second.acquire("pull", STARTED)).toEqual({
      acquired: false,
      holder: { command: "push", pid: process.pid, host: hostname(), started: STARTED },
    });
    await first.release();
    expect(await second.acquire("pull", STARTED)).toEqual({ acquired: true });
  });

  it("gives only two concurrent claims one winner", async () => {
    const at = directory();
    const claims = await Promise.all(
      ["push", "pull", "adopt", "integrate"].map((c) =>
        new FileWorkspaceLock(at).acquire(c, STARTED),
      ),
    );
    expect(claims.filter((c) => c.acquired)).toHaveLength(1);
  });

  it("never releases a lock another command holds", async () => {
    const at = directory();
    const holder = new FileWorkspaceLock(at);
    await holder.acquire("push", STARTED);
    await new FileWorkspaceLock(at).release();
    expect(await new FileWorkspaceLock(at).acquire("pull", STARTED)).toMatchObject({
      acquired: false,
    });
  });

  it("takes over a lock whose command no longer runs on this machine", async () => {
    const at = directory();
    writeLock(at, { command: "push", pid: await endedPid(), host: hostname(), started: STARTED });
    expect(await new FileWorkspaceLock(at).acquire("pull", STARTED)).toEqual({ acquired: true });
    expect(JSON.parse(readFileSync(join(at, "workspace.lock"), "utf8"))).toMatchObject({
      command: "pull",
      pid: process.pid,
    });
  });

  it("keeps a lock taken on another machine, as its process cannot be checked from here", async () => {
    const at = directory();
    const holder = {
      command: "push",
      pid: await endedPid(),
      host: "build-agent-7",
      started: STARTED,
    };
    writeLock(at, holder);
    expect(await new FileWorkspaceLock(at).acquire("pull", STARTED)).toEqual({
      acquired: false,
      holder,
    });
  });

  it("keeps a lock it cannot read, naming no holder", async () => {
    const at = directory();
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, "workspace.lock"), "");
    expect(await new FileWorkspaceLock(at).acquire("pull", STARTED)).toEqual({
      acquired: false,
      holder: null,
    });
  });

  it("gives back a lock another command took over after it was judged stale", async () => {
    const at = directory();
    mkdirSync(at, { recursive: true });
    const path = join(at, "workspace.lock");
    writeFileSync(path, "taken over meanwhile");
    expect(await setAsideStale(path, "the stale lock", `${path}.aside`)).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("taken over meanwhile");
    expect(existsSync(`${path}.aside`)).toBe(false);
  });

  it("finds nothing to set aside when the stale lock was already removed", async () => {
    const path = join(directory(), "workspace.lock");
    expect(await setAsideStale(path, "the stale lock", `${path}.aside`)).toBe(false);
  });

  it("sets aside the stale lock it judged", async () => {
    const at = directory();
    mkdirSync(at, { recursive: true });
    const path = join(at, "workspace.lock");
    writeFileSync(path, "the stale lock");
    expect(await setAsideStale(path, "the stale lock", `${path}.aside`)).toBe(true);
    expect(existsSync(path) || existsSync(`${path}.aside`)).toBe(false);
  });
});
