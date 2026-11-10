import { describe, expect, it } from "bun:test";
import {
  applyRepositoryTuning,
  checkRepositoryTuning,
  type RepositorySetting,
  type WorkspaceStore,
} from "@snagentic/core";

// A repository's large-repository settings, as git reports them in every scope.
function tunedStore(current: Record<string, string | null>) {
  const written: (readonly { key: string; value: string }[])[] = [];
  const settings: RepositorySetting[] = [
    { key: "feature.manyFiles", value: "true", current: current["feature.manyFiles"] ?? null },
    { key: "core.untrackedCache", value: "true", current: current["core.untrackedCache"] ?? null },
  ];
  const store: Pick<WorkspaceStore, "repositoryTuning" | "tuneRepository"> = {
    repositoryTuning: async () => settings,
    tuneRepository: async (_directory, entries) => {
      written.push(entries.map(({ key, value }) => ({ key, value })));
    },
  };
  return { store, written };
}

describe("large-repository tuning of any workspace clone (spec 014, PERF2-04)", () => {
  it("sets the settings a clone lacks, in the repository's own config", async () => {
    const { store, written } = tunedStore({ "feature.manyFiles": "true" });
    expect(await applyRepositoryTuning(store, "/w")).toEqual(["core.untrackedCache"]);
    expect(written).toEqual([[{ key: "core.untrackedCache", value: "true" }]]);
  });

  it("never overrides a value the person set, in any scope, even to turn it off", async () => {
    const { store, written } = tunedStore({
      "feature.manyFiles": "false",
      "core.untrackedCache": "keep",
    });
    expect(await applyRepositoryTuning(store, "/w")).toEqual([]);
    expect(written).toEqual([]);
  });

  it("doctor warns about a clone without the tuning, naming what applies it", async () => {
    const { store } = tunedStore({});
    const check = await checkRepositoryTuning(store, "/w");
    expect(check).toMatchObject({ name: "git-tuning", status: "warn" });
    expect(check.detail).toContain("feature.manyFiles, core.untrackedCache");
    expect(check.hint).toContain("snagentic integrate");
    expect(check.hint).toContain("git config feature.manyFiles true");
  });

  it("doctor is satisfied once every setting has a value", async () => {
    const { store } = tunedStore({ "feature.manyFiles": "true", "core.untrackedCache": "false" });
    expect(await checkRepositoryTuning(store, "/w")).toMatchObject({
      name: "git-tuning",
      status: "ok",
      hint: null,
    });
  });

  it("leaves a workspace that is not a git repository alone", async () => {
    const written: unknown[] = [];
    const store = {
      repositoryTuning: async () => null,
      tuneRepository: async (_d: string, entries: readonly unknown[]) => {
        written.push(entries);
      },
    };
    expect(await applyRepositoryTuning(store, "/w")).toEqual([]);
    expect(written).toEqual([]);
    expect(await checkRepositoryTuning(store, "/w")).toMatchObject({ status: "unavailable" });
  });
});
