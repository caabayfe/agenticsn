import { createReadStream } from "node:fs";
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  type InstanceName,
  instancePaths,
  type KeyedSpill,
  type SpillStore,
} from "@snagentic/core";
import { sweepStaleScratch } from "../fluent/stale-scratch";

// Each spill hashes keys into bucket files; reading one bucket at a time keeps memory at about
// one bucket. A bucket larger than `bucketBytes` is split again by another hash before it is
// read, so a table of any size is read in pieces of about that size; only one key's values
// (one owner's rows) can make a piece larger.
const BUCKETS = 64;
const MAX_SPLITS = 3;
// Lines wait in memory until this much is buffered, then are appended to their buckets.
const BUFFER_BYTES = 1024 * 1024;

export interface SpillLimits {
  readonly bucketBytes: number;
}

const DEFAULT_LIMITS: SpillLimits = { bucketBytes: 2 * 1024 * 1024 };

function bucketOf(key: string, seed: number): number {
  let hash = (2166136261 ^ Math.imul(seed + 1, 16777619)) >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) % BUCKETS;
}

const keyOf = (line: string): string => {
  const [key]: [string] = JSON.parse(line);
  return key;
};

// Lines appended to bucket files under one directory, buffered.
class BucketWriter {
  private readonly buffers = new Map<string, string[]>();
  private buffered = 0;

  async append(path: string, line: string): Promise<void> {
    const lines = this.buffers.get(path);
    if (lines === undefined) {
      this.buffers.set(path, [line]);
    } else {
      lines.push(line);
    }
    this.buffered += line.length;
    if (this.buffered >= BUFFER_BYTES) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    for (const [path, lines] of this.buffers) {
      await appendFile(path, lines.join(""), { encoding: "utf8", mode: 0o600 });
    }
    this.buffers.clear();
    this.buffered = 0;
  }
}

async function* lines(path: string): AsyncIterable<string> {
  const reader = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of reader) {
    if (line !== "") {
      yield line;
    }
  }
}

// Child rows of a pull, spilled to a private folder in the workspace's local state (PERF-07).
// They are written already redacted and secret-scanned, and removed when the spill is closed.
class FileSpill<T> implements KeyedSpill<T> {
  private readonly writer = new BucketWriter();
  private readonly paths = new Set<string>();

  constructor(
    private readonly directory: string,
    private readonly limits: SpillLimits,
  ) {}

  async add(key: string, value: T): Promise<void> {
    const path = join(this.directory, `b${bucketOf(key, 0)}`);
    this.paths.add(path);
    await this.writer.append(path, `${JSON.stringify([key, value])}\n`);
  }

  async *groups(): AsyncIterable<readonly [string, readonly T[]]> {
    await this.writer.flush();
    for (const path of [...this.paths].sort()) {
      yield* this.bucket(path, 1);
    }
  }

  private async *bucket(path: string, depth: number): AsyncIterable<readonly [string, T[]]> {
    if ((await stat(path)).size > this.limits.bucketBytes && depth <= MAX_SPLITS) {
      yield* this.split(path, depth);
      return;
    }
    const groups = new Map<string, T[]>();
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      if (line === "") continue;
      const [key, value]: [string, T] = JSON.parse(line);
      const values = groups.get(key);
      if (values === undefined) groups.set(key, [value]);
      else values.push(value);
    }
    await rm(path, { force: true });
    yield* groups;
  }

  private async *split(path: string, depth: number): AsyncIterable<readonly [string, T[]]> {
    const parts = new Set<string>();
    const writer = new BucketWriter();
    for await (const line of lines(path)) {
      const part = `${path}.${bucketOf(keyOf(line), depth)}`;
      parts.add(part);
      await writer.append(part, `${line}\n`);
    }
    await writer.flush();
    await rm(path, { force: true });
    for (const part of [...parts].sort()) {
      yield* this.bucket(part, depth + 1);
    }
  }

  async close(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }
}

const SPILL = /^snagentic-spill-/;

// Spills in `parent` (.snagentic/<instance>/spill/, gitignored), one private directory each.
// A crashed pull leaves its spills behind: `sweep` removes them, and is called only while the
// instance's workspace lock is held, when no other pull can be using one.
export function fileSpills(parent: string, limits = DEFAULT_LIMITS): SpillStore {
  return {
    open: async <T>(): Promise<KeyedSpill<T>> => {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      // Private even when something else created the folder first.
      await chmod(parent, 0o700);
      return new FileSpill<T>(await mkdtemp(join(parent, "snagentic-spill-")), limits);
    },
    sweep: async () =>
      sweepStaleScratch(parent, Date.now(), Number.NEGATIVE_INFINITY, SPILL).length,
  };
}

// The spills of one instance in a workspace: .snagentic/<instance>/spill/.
export function workspaceSpills(root: string, instance: InstanceName): SpillStore {
  return fileSpills(join(root, instancePaths(instance).localState, "spill"));
}
