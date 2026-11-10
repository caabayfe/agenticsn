import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProfile,
  InstanceName,
  instancePaths,
  type Row,
  usernameResolvingProfiles,
} from "@snagentic/core";
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
import { FAKE_CONTEXT, memoryIdentities, TRUSTED_PASSWORD } from "./fakes";
import { DELIVERY_ADAPTERS } from "./instance-workspace";
import { removeTestTree } from "./remove-test-tree";

const IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@t"];

// A team (ADR-0052): one instance, a bare git remote "origin" holding the workspace and the shared
// mirror, and workspaces that are clones of it, each signing in to the instance as its own user.
export async function team(data: Record<string, Row[]>) {
  const base = await mkdtemp(join(tmpdir(), "snagentic-team-"));
  const origin = join(base, "origin.git");
  await runGitOrThrow(["init", "-q", "--bare", "-b", "main", origin], base);
  const instance = fakeInstance(data);
  let count = 0;
  let committed = "";
  const roots: string[] = [];
  const identities = memoryIdentities();
  const context = (
    root: string,
    at: string,
    environment: Record<string, string> = {},
  ): UseCaseContext => ({
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    profiles: usernameResolvingProfiles(new YamlProfileStore(), {
      environment,
      clone: identities,
    }),
    identities,
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
  // A workspace of this team: a clone of origin (the first one creates it and commits the
  // profile, which names the first member). Every other member signs in as `username` through
  // its clone's identity, or SNAGENTIC_PDI_USERNAME (ADR-0054); instance.yaml stays as committed.
  // `at` is the clock, as an ISO time.
  const member = async (username = "svc_ci", via: "clone" | "environment" = "clone") => {
    count += 1;
    const root = join(base, `w${count}`);
    roots.push(root);
    if (count === 1) {
      await new FsWorkspaceStore().create(root, { layout: 2, createdWith: "test" });
      await runGitOrThrow(["remote", "add", "origin", origin], root);
    } else {
      await runGitOrThrow(["clone", "-q", origin, root], base);
    }
    const profile = createProfile({
      name: InstanceName.parse("pdi"),
      url: "dev1",
      username: count === 1 ? username : committed,
      kind: "development",
      acknowledgeReadOnly: false,
      sharedMirrorRemote: "origin",
    });
    const environment: Record<string, string> = {};
    if (count === 1) {
      committed = username;
      await new YamlProfileStore().write(root, profile);
      await runGitOrThrow(["add", "instances"], root);
      await runGitOrThrow([...IDENTITY, "commit", "-qm", "add pdi"], root);
      await runGitOrThrow(["push", "-q", "origin", "main"], root);
    } else if (username !== committed && via === "clone") {
      await identities.write(root, profile, username);
    } else if (username !== committed) {
      environment["SNAGENTIC_PDI_USERNAME"] = username;
    }
    return { root, at: (time: string) => context(root, time, environment) };
  };
  return {
    origin,
    instance,
    member,
    cleanup: () => removeTestTree(base, roots),
  };
}

export const COMMIT_IDENTITY = IDENTITY;

// A team test runs several clones, fetches and pushes: about 5 s on a Windows runner, so such
// tests get 15 s, as plans do (PLAN_TIMEOUT).
export const TEAM_TIMEOUT = 15_000;
