import { describe, expect, it } from "bun:test";
import {
  initWorkspace,
  locateWorkspace,
  type WorkspaceManifest,
  type WorkspaceStore,
} from "@snagentic/core";

// An in-memory file system: directory path -> manifest (when it is a workspace).
function fakeStore(options: {
  workspaces?: Record<string, unknown>;
  gitRepositories?: string[];
  nonEmpty?: string[];
}) {
  const created: { directory: string; manifest: WorkspaceManifest }[] = [];
  const store: WorkspaceStore = {
    ancestorsOf: (directory) => {
      const parts = directory.split("/").filter(Boolean);
      return parts
        .map((_, index) => `/${parts.slice(0, parts.length - index).join("/")}`)
        .concat("/");
    },
    readManifest: async (directory) => options.workspaces?.[directory] ?? null,
    isInsideGitRepository: async (directory) =>
      (options.gitRepositories ?? []).some((repository) => directory.startsWith(repository)),
    isEmptyOrMissing: async (directory) => !(options.nonEmpty ?? []).includes(directory),
    create: async (directory, manifest) => {
      created.push({ directory, manifest });
    },
  };
  return { store, created };
}

const MANIFEST = { layout: 1, createdWith: "snagentic test" };

describe("initWorkspace", () => {
  it("creates a workspace in an empty folder outside any repository", async () => {
    const { store, created } = fakeStore({});
    await initWorkspace("/home/me/snagentic/acme", "snagentic test", store);
    expect(created).toEqual([{ directory: "/home/me/snagentic/acme", manifest: MANIFEST }]);
  });

  it("refuses to create a workspace inside another git repository", async () => {
    const { store } = fakeStore({ gitRepositories: ["/code/snagentic"] });
    await expect(initWorkspace("/code/snagentic/data", "x", store)).rejects.toMatchObject({
      code: "nested-repository",
    });
  });

  it("refuses to overwrite an existing workspace", async () => {
    const { store } = fakeStore({ workspaces: { "/w": MANIFEST } });
    await expect(initWorkspace("/w", "x", store)).rejects.toMatchObject({
      code: "workspace-exists",
    });
  });

  it("refuses a folder that already contains files", async () => {
    const { store } = fakeStore({ nonEmpty: ["/home/me/notes"] });
    await expect(initWorkspace("/home/me/notes", "x", store)).rejects.toMatchObject({
      code: "directory-not-empty",
    });
  });
});

describe("locateWorkspace", () => {
  it("finds the workspace from any folder inside it", async () => {
    const { store } = fakeStore({ workspaces: { "/w/acme": MANIFEST } });
    expect(await locateWorkspace("/w/acme/instances/dev/metadata", store)).toEqual({
      root: "/w/acme",
      manifest: MANIFEST,
    });
  });

  it("uses the nearest workspace when workspaces are nested by mistake", async () => {
    const { store } = fakeStore({ workspaces: { "/w": MANIFEST, "/w/inner": MANIFEST } });
    expect((await locateWorkspace("/w/inner/x", store)).root).toBe("/w/inner");
  });

  it("explains how to create one when there is no workspace", async () => {
    const { store } = fakeStore({});
    await expect(locateWorkspace("/tmp/elsewhere", store)).rejects.toMatchObject({
      code: "workspace-not-found",
    });
  });

  it("refuses a workspace with an unknown layout", async () => {
    const { store } = fakeStore({ workspaces: { "/w": { layout: 9 } } });
    await expect(locateWorkspace("/w", store)).rejects.toMatchObject({ code: "workspace-layout" });
  });
});
