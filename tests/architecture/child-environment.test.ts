import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

// Every process snagentic starts gets childEnvironment(), so no instance credential reaches git,
// gh, tar, a media tool or a new binary (spec 012, step 3). A source check, because forgetting
// `env` silently passes the whole environment. The Fluent SDK worker gets workerEnvironment(), an
// allow-list stricter still (ADR-0044).
const ROOT = join(import.meta.dir, "../..");
const SPAWN = /Bun\.spawn(?:Sync)?\(|from "node:child_process"/g;

function productFiles(): string[] {
  return [...new Glob("packages/*/src/**/*.ts").scanSync(ROOT)].filter(
    (path) => !path.endsWith(".test.ts"),
  );
}

describe("child processes never get instance credentials", () => {
  it("passes childEnvironment() or workerEnvironment() to every spawn in product code", () => {
    const missing = productFiles().filter((path) => {
      const source = readFileSync(join(ROOT, path), "utf8");
      const spawns = source.match(SPAWN)?.length ?? 0;
      const guarded = source.match(/env: (?:childEnvironment|workerEnvironment)\(/g)?.length ?? 0;
      return spawns > guarded;
    });
    expect(missing).toEqual([]);
  });
});
