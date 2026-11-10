import { join } from "node:path";
import {
  type CatalogData,
  type InstanceName,
  instancePaths,
  type PullCheckpoint,
  type SyncState,
  type SyncStateStore,
} from "@snagentic/core";
import { parse } from "yaml";
import type { z } from "zod";
import { runGit } from "../git/run-git";
import { JsonSyncStateStore } from "./json-sync-state-store";
import { checkStateValue } from "./state-file";
import { CatalogFile, SyncStateFile } from "./sync-state-schemas";

// A file in a mirror commit is data, not trust (ADR-0052 item 7): it is checked like local state.
function parsed<T>(label: string, text: string, schema: z.ZodType<T>, hint: string): T {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch {
    raw = undefined;
  }
  return checkStateValue(label, raw, schema, hint);
}

const fullPullHint = (instance: string) =>
  `run snagentic pull ${instance} --full to write it again`;

async function show(repository: string, commit: string, path: string): Promise<string | null> {
  const result = await runGit(["show", `${commit}:${path}`], repository);
  return result.exitCode === 0 ? result.stdout : null;
}

// The pull state a mirror commit carries, checked; null when it carries none.
export async function pullStateAt(
  repository: string,
  commit: string,
  instance: InstanceName,
): Promise<SyncState | null> {
  const path = instancePaths(instance).pullState;
  const text = await show(repository, commit, path);
  return text === null
    ? null
    : parsed(`${commit}:${path}`, text, SyncStateFile, fullPullHint(instance));
}

// The pull state of an instance (ADR-0052): read from the tip of servicenow-remote/<name>, which
// any clone has once it fetched the branch. A workspace an earlier version pulled has it in
// .snagentic/<name>/ until its next pull commit carries it. The checkpoint, and the note of a
// check that found nothing new, belong to this clone.
export class MirrorSyncStateStore implements SyncStateStore {
  private readonly paths;
  private readonly hint;

  constructor(
    private readonly repository: string,
    instance: InstanceName,
    private readonly local: JsonSyncStateStore,
  ) {
    this.paths = instancePaths(instance);
    this.hint = fullPullHint(instance);
  }

  async readState(): Promise<SyncState | null> {
    const tip = await this.tip();
    const text = tip === null ? null : await this.show(tip, this.paths.pullState);
    if (tip === null || text === null) return this.local.readLegacyState();
    const note = await this.local.readNote();
    if (note !== null && note.commit === tip) return note.state;
    return parsed(`${tip}:${this.paths.pullState}`, text, SyncStateFile, this.hint);
  }

  async readCatalog(): Promise<CatalogData | null> {
    const tip = await this.tip();
    const text = tip === null ? null : await this.show(tip, this.paths.pullCatalog);
    if (tip === null || text === null) return this.local.readLegacyCatalog();
    return parsed(`${tip}:${this.paths.pullCatalog}`, text, CatalogFile, this.hint);
  }

  async heldLocally(): Promise<boolean> {
    const tip = await this.tip();
    const inMirror = tip !== null && (await this.show(tip, this.paths.pullState)) !== null;
    return !inMirror && this.local.hasLegacyState();
  }

  async noteUnchanged(state: SyncState): Promise<void> {
    const tip = await this.tip();
    if (tip !== null) await this.local.writeNote({ commit: tip, state });
  }

  forgetLocalState(): Promise<void> {
    return this.local.forgetLegacy();
  }

  readCheckpoint(): Promise<PullCheckpoint | null> {
    return this.local.readCheckpoint();
  }

  writeCheckpoint(checkpoint: PullCheckpoint): Promise<void> {
    return this.local.writeCheckpoint(checkpoint);
  }

  clearCheckpoint(): Promise<void> {
    return this.local.clearCheckpoint();
  }

  private async tip(): Promise<string | null> {
    const ref = `refs/heads/${this.paths.remoteBranch}`;
    const result = await runGit(["rev-parse", "--verify", "--quiet", ref], this.repository);
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  private show(commit: string, path: string): Promise<string | null> {
    return show(this.repository, commit, path);
  }
}

// The sync state store of an instance in a workspace.
export function syncStateStore(root: string, instance: InstanceName): MirrorSyncStateStore {
  return new MirrorSyncStateStore(
    root,
    instance,
    new JsonSyncStateStore(join(root, instancePaths(instance).localState)),
  );
}
