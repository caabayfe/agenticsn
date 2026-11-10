import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adrIndexTable, parseAdr, readAdrs, withAdrIndex } from "../../scripts/adr-index";

const ADR_DIR = join(import.meta.dir, "../../docs/adr");

const adr = (lines: readonly string[]) => `${lines.join("\n")}\n\n## Context\n`;

describe("ADR index (spec 014, F9)", () => {
  it("is committed up to date with the ADR files (run: bun run docs)", () => {
    const readme = readFileSync(join(ADR_DIR, "README.md"), "utf8");
    expect(readme).toBe(withAdrIndex(readme, adrIndexTable(readAdrs(ADR_DIR))));
  });

  it("reads the title and the status word from the status line, without its details", () => {
    const entry = parseAdr(
      "0012-read-only.md",
      adr([
        "# 0012. Production access is read-only by construction",
        "",
        "- Status: Accepted, pending the read-only role spike (amended by 0013)",
        "- Date: 2026-10-06",
      ]),
    );
    expect(entry).toEqual({
      number: "0012",
      file: "0012-read-only.md",
      title: "Production access is read-only by construction",
      status: "Accepted, pending the read-only role spike",
      amendedBy: ["0013"],
      amendedOn: [],
      amends: [],
    });
  });

  it("reads amendments from continued status lines and from the Amends field", () => {
    const entry = parseAdr(
      "0038-install.md",
      adr([
        "# 0038. Accelerators install by plan",
        "",
        "- Status: Accepted (product owner, 2026-10-19). Item 8 amended by 0042",
        "  (layouts). Components amended 2026-10-24 by the product owner",
        "- Amends: 0012 (one narrow write), 0026 (the rejected single install,",
        "  the pack scope), ASR-15",
      ]),
    );
    expect(entry.status).toBe("Accepted");
    expect(entry.amendedBy).toEqual(["0042"]);
    expect(entry.amendedOn).toEqual(["2026-10-24"]);
    expect(entry.amends).toEqual(["0012", "0026"]);
  });

  it("lists an amendment from the amending record, and ignores what a proposal would amend", () => {
    const entries = [
      parseAdr("0010-scope.md", adr(["# 0010. Scope", "", "- Status: Accepted"])),
      parseAdr("0036-docs.md", adr(["# 0036. Docs", "", "- Status: Accepted", "- Amends: 0010"])),
      parseAdr(
        "0045-restore.md",
        adr([
          "# 0045. Restore",
          "",
          "- Status: Proposed (2026-10-27)",
          "- Amends, when accepted:",
          "  - 0010: scope",
        ]),
      ),
    ];
    expect(adrIndexTable(entries)).toBe(
      [
        "| ADR | Title | Status |",
        "|---|---|---|",
        "| [0010](0010-scope.md) | Scope | Accepted (amended by 0036) |",
        "| [0036](0036-docs.md) | Docs | Accepted |",
        "| [0045](0045-restore.md) | Restore | Proposed |",
        "",
      ].join("\n"),
    );
  });

  it("shows a superseded record without its amendments", () => {
    const entries = [
      parseAdr(
        "0024-acl.md",
        adr(["# 0024. ACLs", "", "- Status: Superseded by 0031 (2026-10-16): loaded"]),
      ),
      parseAdr("0030-load.md", adr(["# 0030. Load", "", "- Status: Accepted", "- Amends: 0024"])),
    ];
    expect(adrIndexTable(entries)).toContain("| [0024](0024-acl.md) | ACLs | Superseded by 0031 |");
  });

  it("replaces only the generated table between the markers", () => {
    const readme = [
      "# Records",
      "",
      "<!-- adr-index:start -->",
      "old table",
      "<!-- adr-index:end -->",
      "",
      "## Open questions",
      "",
    ].join("\n");
    expect(withAdrIndex(readme, "| new |\n")).toBe(
      [
        "# Records",
        "",
        "<!-- adr-index:start -->",
        "| new |",
        "<!-- adr-index:end -->",
        "",
        "## Open questions",
        "",
      ].join("\n"),
    );
  });
});
