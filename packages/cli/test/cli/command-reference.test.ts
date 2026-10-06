import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commandReference } from "../../src/cli/command-reference";
import { USE_CASES } from "../../src/registry/registry";

const COMMITTED = join(import.meta.dir, "../../../../docs/reference/commands.md");

describe("command reference", () => {
  it("is committed up to date with the registry (run: bun run docs)", () => {
    expect(readFileSync(COMMITTED, "utf8")).toBe(commandReference(USE_CASES));
  });

  it("documents every command and tool, and marks the one that changes an instance", () => {
    const reference = commandReference(USE_CASES);
    expect(reference).toContain("snagentic pull <instance> [options]");
    expect(reference).toContain("`--verify`");
    expect(reference).toContain("Changes the instance: **yes, development instances only**.");
    expect(reference).toContain("- `update_sets`:");
    expect(reference).toContain("`action` (list | show | collisions | export, required)");
    expect(reference).not.toContain("### `update-sets-tool`");
  });
});
