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
    expect(reference).toContain(
      "Writes to the development instance and commits delivery ledgers locally",
    );
    expect(reference).toContain("- `update_sets`:");
    expect(reference).toContain("`action` (list | show | collisions | export, required)");
    expect(reference).not.toContain("### `update-sets-tool`");
  });

  it("shares human help, required flags, defaults, examples and accurate effects", () => {
    const reference = commandReference(USE_CASES);
    expect(reference).toContain("--help-all");
    expect(reference).toContain("Maximum number of results (default: 20; range: 1–100)");
    const push = reference.split("### `push`")[1]?.split("###")[0] ?? "";
    expect(push).toContain("Required:");
    expect(push).toContain("`--plan <plan>`");
    expect(push).toContain("snagentic push --instance dev --plan PLAN_ID --confirm");
    expect(push).not.toContain("confirm=true");
    const adopt = reference.split("### `adopt`")[1]?.split("###")[0] ?? "";
    expect(adopt).toContain("Does not write to the instance.");
    expect(adopt).not.toContain("Changes the instance: **yes");
  });
});
