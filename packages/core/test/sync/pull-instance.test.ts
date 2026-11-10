import { describe, expect, it } from "bun:test";
import {
  createProfile,
  type InstanceKind,
  InstanceName,
  type PullCheckpoint,
  type PullPorts,
  pullInstance,
  type SharedTip,
  type SyncState,
} from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";
import { instanceTables, LIVE } from "../support/incremental-fixture";
import { memoryMirror } from "../support/memory-mirror";
import { memorySpills } from "../support/memory-spill";

const NOW = new Date("2026-11-10T12:00:00Z");
const RUN = { signal: LIVE, progress: () => {} };
const REQUEST = { full: false, verify: false, publish: false, cost: false, now: false };

const profileOf = (kind: InstanceKind = "development", shared = true, username = "svc_ci") =>
  createProfile({
    name: InstanceName.parse("pdi"),
    url: "dev1",
    username,
    kind,
    acknowledgeReadOnly: kind !== "development",
    ...(shared ? { sharedMirrorRemote: "origin" } : {}),
  });

// A clone with no pull of its own, a team remote holding `shared`, and an instance that counts
// how often a pull connects to it.
function clone(shared: SharedTip | null, pushes: ("published" | "rejected")[] = []) {
  let tip: string | null = null;
  let checkpoint: PullCheckpoint | null = null;
  let commits = 0;
  const seen = { connections: 0, published: [] as string[] };
  const ports: PullPorts = {
    prepareClone: async () => {},
    credentials: {
      read: async (profile) => ({
        secret: "pw",
        source: "keychain",
        trusted: { url: profile.url, kind: profile.kind },
      }),
      write: async () => {},
      remove: async () => false,
    },
    connect: () => {
      seen.connections += 1;
      return fakeInstance(instanceTables()).reader;
    },
    state: {
      readCatalog: async () => null,
      readState: async (): Promise<SyncState | null> =>
        tip !== null && tip === shared?.commit ? shared.state : null,
      readCheckpoint: async () => checkpoint,
      writeCheckpoint: async (value) => {
        checkpoint = value;
      },
      clearCheckpoint: async () => {
        checkpoint = null;
      },
      heldLocally: async () => false,
      noteUnchanged: async () => {},
      forgetLocalState: async () => {},
      readTrust: async () => ({}),
      noteTrust: async () => {},
    },
    mirror: async () => {
      const { mirror } = memoryMirror();
      return {
        ...mirror,
        finish: async () => {
          commits += 1;
          return { commit: `c${commits}`, created: true };
        },
      };
    },
    spills: memorySpills(),
    shared: {
      fetch: async () => shared,
      lastFetched: async () => null,
      localTip: async () => tip,
      contains: async (_root, descendant, ancestor) => descendant === ancestor,
      moveTo: async (_root, _instance, move) => {
        tip = move.commit;
      },
      publish: async (_root, _instance, _remote, commit) => {
        seen.published.push(commit);
        return pushes.shift() ?? "published";
      },
    },
    clock: () => NOW,
    elapsed: () => 0,
    memory: () => 0,
    version: "test",
  };
  return { ports, seen };
}

const young = { commit: "s1", state: { watermark: "2026-11-10 11:55:00", lastFullPull: "x" } };
// Published by the scheduled pull an hour ago: older than the default max age of 30 minutes.
const stale = {
  commit: "s1",
  state: { watermark: "2026-11-10 11:00:00", lastFullPull: "x", pulledBy: "svc_ci" },
};
const developer = () => profileOf("development", true, "jdoe");
// The pull connected and went on to an incremental pull from the shared state, which this fake
// clone cannot finish: it holds no catalog. The connection is what these tests are about.
const reachesInstance = (pull: Promise<unknown>) =>
  expect(pull).rejects.toMatchObject({ code: "full-pull-required" });

describe("pullInstance (ADR-0052)", () => {
  it("asks the instance nothing while the shared mirror is younger than its max age", async () => {
    const { ports, seen } = clone(young);
    const outcome = await pullInstance(ports, "/w", profileOf(), REQUEST, RUN);
    expect(outcome).toMatchObject({
      mode: "current",
      commit: "s1",
      shared: { published: false, start: { from: "shared", current: true } },
    });
    expect(seen.connections).toBe(0);
  });

  it("pulls from the instance when there is nothing to continue from", async () => {
    const { ports, seen } = clone(null);
    const outcome = await pullInstance(ports, "/w", profileOf(), REQUEST, RUN);
    expect(outcome).toMatchObject({ mode: "full", shared: { published: false } });
    expect(seen.connections).toBe(1);
  });

  it("refuses --cost on an instance that is not a development one, before asking anything", async () => {
    const { ports, seen } = clone(young);
    const request = { ...REQUEST, cost: true };
    await expect(pullInstance(ports, "/w", profileOf("test"), request, RUN)).rejects.toMatchObject({
      code: "cost-needs-development",
    });
    expect(seen.connections).toBe(0);
  });

  it("refuses --publish without a shared mirror, and --verify without a pull to check", async () => {
    const { ports, seen } = clone(null);
    const solo = profileOf("development", false);
    await expect(
      pullInstance(ports, "/w", solo, { ...REQUEST, publish: true }, RUN),
    ).rejects.toMatchObject({ code: "publish-needs-shared-mirror" });
    await expect(
      pullInstance(ports, "/w", solo, { ...REQUEST, verify: true }, RUN),
    ).rejects.toMatchObject({ code: "verify-needs-pull" });
    expect(seen.connections).toBe(0);
  });

  it("publishes fast-forward only: a refused push pulls again from the newer commit, once", async () => {
    const retried = clone(null, ["rejected", "published"]);
    const request = { ...REQUEST, publish: true };
    expect(await pullInstance(retried.ports, "/w", profileOf(), request, RUN)).toMatchObject({
      shared: { published: true },
    });
    expect(retried.seen.published).toEqual(["c1", "c2"]);
    const refused = clone(null, ["rejected", "rejected"]);
    await expect(
      pullInstance(refused.ports, "/w", profileOf(), request, RUN),
    ).rejects.toMatchObject({ code: "publish-rejected" });
    expect(refused.seen.connections).toBe(2);
  });
});

describe("pullInstance: a stale shared mirror (ADR-0052 A2)", () => {
  it("takes the stale mirror for a developer who is not its publisher, asking the instance nothing", async () => {
    const { ports, seen } = clone(stale);
    const outcome = await pullInstance(ports, "/w", developer(), REQUEST, RUN);
    expect(outcome).toMatchObject({
      mode: "stale",
      commit: "s1",
      publisher: "svc_ci",
      shared: { published: false, start: { from: "shared", current: false } },
    });
    expect(seen.connections).toBe(0);
  });

  it("asks the instance nothing without --now, even for --full or --verify", async () => {
    const { ports, seen } = clone(stale);
    for (const flags of [{ full: true }, { verify: true }]) {
      const request = { ...REQUEST, ...flags };
      expect(await pullInstance(ports, "/w", developer(), request, RUN)).toMatchObject({
        mode: "stale",
      });
    }
    expect(seen.connections).toBe(0);
  });

  it("pulls from the instance with --now", async () => {
    const { ports, seen } = clone(stale);
    const request = { ...REQUEST, now: true };
    await reachesInstance(pullInstance(ports, "/w", developer(), request, RUN));
    expect(seen.connections).toBe(1);
  });

  it("leaves the publisher's own pull unchanged: it reaches the instance", async () => {
    const { ports, seen } = clone(stale);
    await reachesInstance(pullInstance(ports, "/w", profileOf(), REQUEST, RUN));
    expect(seen.connections).toBe(1);
  });

  it("keeps today's behaviour for a shared mirror that names no publisher", async () => {
    const unnamed = {
      commit: "s1",
      state: { watermark: "2026-11-10 11:00:00", lastFullPull: "x" },
    };
    const { ports, seen } = clone(unnamed);
    await reachesInstance(pullInstance(ports, "/w", developer(), REQUEST, RUN));
    expect(seen.connections).toBe(1);
  });

  it("leaves solo mode unchanged: without a shared mirror a pull reaches the instance", async () => {
    const { ports, seen } = clone(stale);
    const solo = profileOf("development", false, "jdoe");
    expect(await pullInstance(ports, "/w", solo, REQUEST, RUN)).toMatchObject({ mode: "full" });
    expect(seen.connections).toBe(1);
  });
});
