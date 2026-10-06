import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfile, InstanceName, instancePaths, type Row } from "@snagentic/core";
import { fakeInstance } from "../../../core/test/support/fake-instance";
import { fsWorkspaceFiles } from "../../src/adapters/fs/fs-workspace-files";
import { gitInspector } from "../../src/adapters/git/git-inspector";
import { gitIntegrator } from "../../src/adapters/git/git-integrator";
import { gitInventoryReader } from "../../src/adapters/git/git-inventory-reader";
import { GitMirror } from "../../src/adapters/git/git-mirror";
import { EslintScriptChecker } from "../../src/adapters/governance/eslint-script-checker";
import { GitChangedRecords } from "../../src/adapters/governance/git-changed-records";
import { GitMirrorFiles } from "../../src/adapters/knowledge/git-mirror-files";
import { SqliteKnowledgeStore } from "../../src/adapters/knowledge/sqlite-knowledge-store";
import { YamlProfileStore } from "../../src/adapters/profiles/yaml-profile-store";
import { JsonSyncStateStore } from "../../src/adapters/state/json-sync-state-store";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import type { UseCaseContext } from "../../src/registry/use-case";
import { FAKE_CONTEXT } from "./fakes";

// A real workspace with a "pdi" development profile, connected to an in-memory instance.
// Files written by use cases are captured instead of written.
export async function instanceWorkspace(
  data: Record<string, Row[]>,
  kind: "development" | "test" | "production" = "development",
) {
  const base = await mkdtemp(join(tmpdir(), "snagentic-workspace-"));
  const root = join(base, "w");
  await new FsWorkspaceStore().create(root, { layout: 1, createdWith: "test" });
  const profiles = new YamlProfileStore();
  await profiles.write(
    root,
    createProfile({
      name: InstanceName.parse("pdi"),
      url: "dev1",
      username: "admin",
      kind,
      acknowledgeReadOnly: kind !== "development",
    }),
  );
  const instance = fakeInstance(data);
  const written = new Map<string, string>();
  const context: UseCaseContext = {
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    profiles,
    credentials: { read: async () => "pw", write: async () => {}, remove: async () => false },
    connections: { open: () => instance.reader },
    syncState: (r, name) => new JsonSyncStateStore(join(r, instancePaths(name).localState)),
    mirrors: { open: (r, name, mode) => GitMirror.open(r, name, mode) },
    integrator: gitIntegrator,
    inspector: gitInspector,
    inventory: gitInventoryReader,
    knowledge: (r, name) => ({
      store: new SqliteKnowledgeStore(join(r, instancePaths(name).localState, "knowledge.sqlite")),
      files: new GitMirrorFiles(r, instancePaths(name).metadata),
    }),
    workspaceFiles: fsWorkspaceFiles,
    governance: (r, name) => ({
      records: new GitChangedRecords(r, instancePaths(name).metadata),
      checker: new EslintScriptChecker(),
    }),
    files: {
      write: async (path, content) => {
        written.set(path, content);
      },
    },
    host: { cwd: root, home: base, version: "test" },
  };
  return {
    root,
    context,
    instance,
    written,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
