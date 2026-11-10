import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfile, InstanceName, instancePaths, type Row } from "@snagentic/core";
import { fakeInstance } from "../../../core/test/support/fake-instance";
import { gitInspector } from "../../src/adapters/git/git-inspector";
import { gitIntegrator } from "../../src/adapters/git/git-integrator";
import { gitInventoryReader } from "../../src/adapters/git/git-inventory-reader";
import { GitMirror } from "../../src/adapters/git/git-mirror";
import { gitSharedMirror } from "../../src/adapters/git/git-shared-mirror";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { GitMirrorFiles } from "../../src/adapters/knowledge/git-mirror-files";
import { SqliteKnowledgeStore } from "../../src/adapters/knowledge/sqlite-knowledge-store";
import { YamlProfileStore } from "../../src/adapters/profiles/yaml-profile-store";
import { JsonPushJournalStore } from "../../src/adapters/state/json-push-journal-store";
import { syncStateStore } from "../../src/adapters/state/mirror-sync-state-store";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import type { UseCaseContext } from "../../src/registry/use-case";
import { FAKE_CONTEXT, TRUSTED_PASSWORD } from "./fakes";
import { DELIVERY_ADAPTERS } from "./instance-workspace";

const IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@t"];

// A team (ADR-0052): one instance, a bare git remote "origin" holding the workspace and the shared
// mirror, and workspaces that are clones of it, each signing in to the instance as its own user.
export async function team(data: Record<string, Row[]>) {
  const base = await mkdtemp(join(tmpdir(), "snagentic-team-"));
  const origin = join(base, "origin.git");
  await runGitOrThrow(["init", "-q", "--bare", "-b", "main", origin], base);
  const instance = fakeInstance(data);
  let count = 0;
  const context = (root: string, at: string): UseCaseContext => ({
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    profiles: new YamlProfileStore(),
    credentials: TRUSTED_PASSWORD,
    connections: { open: () => instance.reader, openForWrite: () => instance.reader },
    syncState: syncStateStore,
    sharedMirror: gitSharedMirror,
    mirrors: { open: (r, name, mode) => GitMirror.open(r, name, mode) },
    integrator: gitIntegrator,
    inspector: gitInspector,
    inventory: gitInventoryReader,
    knowledge: (r, name) => ({
      store: new SqliteKnowledgeStore(join(r, instancePaths(name).localState, "knowledge.sqlite")),
      files: new GitMirrorFiles(r, instancePaths(name).metadata),
    }),
    ...DELIVERY_ADAPTERS,
    pushJournal: (r, name) => new JsonPushJournalStore(join(r, instancePaths(name).localState)),
    clock: () => new Date(at),
    host: { cwd: root, home: base, version: "test" },
  });
  // A workspace of this team: a clone of origin (the first one creates it), whose profile signs
  // in as `username`. `at` is the clock, as an ISO time.
  const member = async (username = "svc_ci") => {
    count += 1;
    const root = join(base, `w${count}`);
    if (count === 1) {
      await new FsWorkspaceStore().create(root, { layout: 2, createdWith: "test" });
      await runGitOrThrow(["remote", "add", "origin", origin], root);
    } else {
      await runGitOrThrow(["clone", "-q", origin, root], base);
    }
    const profile = createProfile({
      name: InstanceName.parse("pdi"),
      url: "dev1",
      username,
      kind: "development",
      acknowledgeReadOnly: false,
      sharedMirrorRemote: "origin",
    });
    await new YamlProfileStore().write(root, profile);
    if (count === 1) {
      await runGitOrThrow(["add", "instances"], root);
      await runGitOrThrow([...IDENTITY, "commit", "-qm", "add pdi"], root);
      await runGitOrThrow(["push", "-q", "origin", "main"], root);
    }
    return { root, at: (time: string) => context(root, time) };
  };
  return {
    origin,
    instance,
    member,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

export const COMMIT_IDENTITY = IDENTITY;

// A team test runs several clones, fetches and pushes: about 5 s on a Windows runner, so such
// tests get 15 s, as plans do (PLAN_TIMEOUT).
export const TEAM_TIMEOUT = 15_000;
