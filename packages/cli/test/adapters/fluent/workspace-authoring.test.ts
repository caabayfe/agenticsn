import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_LEDGER, LedgerUncommittedError, withEntries } from "@snagentic/core";
import { fromCommit } from "../../../src/adapters/fluent/build-in-copy";
import { WorkspaceAuthoring } from "../../../src/adapters/fluent/workspace-authoring";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";

const runtime = async () => ({
  sdkVersion: "4.13.6",
  build: async () => ({ success: true as const, records: [] }),
  transform: async () => ({ success: false as const, message: "unused" }),
});

async function repository() {
  const root = mkdtempSync(join(tmpdir(), "snagentic-authoring-"));
  await runGitOrThrow(["init", "-q"], root);
  await runGitOrThrow(["config", "user.email", "dev@example.com"], root);
  await runGitOrThrow(["config", "user.name", "dev"], root);
  const authoring = new WorkspaceAuthoring(root, runtime);
  const project = await authoring.scaffold({ name: "x_app", sysId: "a".repeat(32) });
  return { root, authoring, project };
}

const commitAll = async (root: string, message: string) => {
  await runGitOrThrow(["add", "-A"], root);
  await runGitOrThrow(["commit", "-qm", message], root);
  return (await runGitOrThrow(["rev-parse", "HEAD"], root)).trim();
};

const SCRIPT = "src/fluent/si.server.js";
const lines = (...items: string[]) => `${items.join("\n")}\n`;

describe("WorkspaceAuthoring", () => {
  it("scaffolds a configuration project with the embedded SDK's version", async () => {
    const { root, authoring, project } = await repository();
    expect(project).toEqual({ path: "source/x_app", scope: "x_app", scopeId: "a".repeat(32) });
    expect(
      JSON.parse(readFileSync(join(root, "source/x_app/now.config.json"), "utf8")),
    ).toMatchObject({
      type: "configuration",
    });
    expect(readFileSync(join(root, "source/x_app/package.json"), "utf8")).toContain(
      '"@servicenow/sdk": "4.13.6"',
    );
    expect(await authoring.project("x_app")).toEqual(project);
    expect(await authoring.project("x_other")).toBeNull();
  });

  it("writes the ledger it reads, and names the commit that last changed it", async () => {
    const { root, authoring, project } = await repository();
    expect(await authoring.ledgerCommit(project)).toBeNull();
    const entry = { build: "b", instance: "1|2026-10-16 06:30:48", losses: [] };
    await authoring.writeLedger(
      project,
      withEntries(EMPTY_LEDGER, "pdi2", new Map([["u", entry]])),
    );
    await expect(authoring.ledgerCommit(project)).rejects.toBeInstanceOf(LedgerUncommittedError);
    const commit = await commitAll(root, "adopt");
    expect(await authoring.ledgerCommit(project)).toBe(commit);
    expect((await authoring.readLedger(project)).get("pdi2")?.get("u")).toEqual(entry);
  });

  it("merges an instance edit with local work, as git merges", async () => {
    const { root, authoring, project } = await repository();
    await authoring.writeFiles(
      project,
      new Map([[SCRIPT, lines("var a = 1;", "", "", "var b = 2;")]]),
    );
    await authoring.writeLedger(project, EMPTY_LEDGER);
    const base = await commitAll(root, "adopt");
    writeFileSync(join(root, "source/x_app", SCRIPT), lines("var a = 10;", "", "", "var b = 2;"));
    const conflicts = await authoring.mergeFiles(
      project,
      base,
      new Map([[SCRIPT, lines("var a = 1;", "", "", "var b = 20;")]]),
    );
    expect(conflicts).toEqual([]);
    expect(readFileSync(join(root, "source/x_app", SCRIPT), "utf8")).toBe(
      lines("var a = 10;", "", "", "var b = 20;"),
    );
  });

  it("leaves conflict markers where local and instance edits overlap", async () => {
    const { root, authoring, project } = await repository();
    await authoring.writeFiles(project, new Map([[SCRIPT, lines("var a = 1;")]]));
    const base = await commitAll(root, "adopt");
    writeFileSync(join(root, "source/x_app", SCRIPT), lines("var a = 'local';"));
    expect(
      await authoring.mergeFiles(project, base, new Map([[SCRIPT, lines("var a = 'instance';")]])),
    ).toEqual([SCRIPT]);
    const merged = readFileSync(join(root, "source/x_app", SCRIPT), "utf8");
    expect(merged).toContain("<<<<<<< local");
    expect(merged).toContain(">>>>>>> instance");
  });
});

describe("fromCommit", () => {
  it("copies a project as a commit held it, leaving the working tree alone", async () => {
    const { root, authoring, project } = await repository();
    await authoring.writeFiles(project, new Map([[SCRIPT, lines("var a = 1;")]]));
    const base = await commitAll(root, "adopt");
    writeFileSync(join(root, "source/x_app", SCRIPT), lines("var a = 2;"));
    const scratch = mkdtempSync(join(tmpdir(), "snagentic-from-commit-"));
    await fromCommit(root, project.path, base)(join(scratch, "copy"));
    expect(readFileSync(join(scratch, "copy", SCRIPT), "utf8")).toBe(lines("var a = 1;"));
    expect(readFileSync(join(root, "source/x_app", SCRIPT), "utf8")).toBe(lines("var a = 2;"));
    await expect(
      fromCommit(root, project.path, "0".repeat(40))(join(scratch, "other")),
    ).rejects.toThrow();
  });
});
