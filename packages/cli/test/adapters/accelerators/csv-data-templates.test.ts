import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CsvDataTemplates, parseCsv } from "../../../src/adapters/accelerators/csv-data-templates";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";

describe("CSV data templates", () => {
  it("parses quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF", () => {
    expect(parseCsv('name,notes\r\n"Desk, L1","say ""hi""\nthen"\r\nNet,\n\n')).toEqual([
      ["name", "notes"],
      ["Desk, L1", 'say "hi"\nthen'],
      ["Net", ""],
    ]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
  });

  it("reads a template's header and rows, and nothing for a missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "templates-"));
    writeFileSync(join(dir, "group.csv"), "﻿name , manager\nDesk,Ann\n");
    const templates = new CsvDataTemplates();
    expect(await templates.read(dir, "group.csv")).toEqual({
      columns: ["name", "manager"],
      rows: [["Desk", "Ann"]],
    });
    expect(await templates.read(dir, "user.csv")).toBeNull();
  });

  it("knows whether git tracks the directory's files", async () => {
    const outside = mkdtempSync(join(tmpdir(), "data-"));
    const templates = new CsvDataTemplates();
    expect(await templates.tracked(outside)).toBe(false);
    const repo = mkdtempSync(join(tmpdir(), "repo-"));
    await runGitOrThrow(["init", "-q"], repo);
    writeFileSync(join(repo, "group.csv"), "name\n");
    expect(await templates.tracked(repo)).toBe(false);
    await runGitOrThrow(["add", "group.csv"], repo);
    expect(await templates.tracked(repo)).toBe(true);
  });
});
