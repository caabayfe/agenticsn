import { describe, expect, it } from "bun:test";
import {
  assetName,
  checkDue,
  compareVersions,
  expectedSum,
  noticeAllowed,
  parseVersion,
  sha256Hex,
  upgradeSteps,
} from "@snagentic/core";

describe("versions", () => {
  it("reads release tags and plain versions, and nothing else", () => {
    expect(parseVersion("v1.2.1")).toBe("1.2.1");
    expect(parseVersion("1.10.0")).toBe("1.10.0");
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
  });

  it("compares numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.1", "1.2.1")).toBe(0);
    expect(compareVersions("1.2.0", "2.0.0")).toBeLessThan(0);
  });
});

describe("release assets", () => {
  it("names the binary a release publishes for each supported platform", () => {
    expect(assetName("darwin", "arm64")).toBe("snagentic-macos-arm64");
    expect(assetName("linux", "x64")).toBe("snagentic-linux-x64");
    expect(assetName("linux", "arm64")).toBe("snagentic-linux-arm64");
    expect(assetName("win32", "x64")).toBe("snagentic-windows-x64.exe");
    expect(assetName("darwin", "x64")).toBeNull();
  });

  it("finds a file's sum in SHA256SUMS, and checks bytes against it", () => {
    const bytes = new TextEncoder().encode("binary");
    const sum = sha256Hex(bytes);
    const sums = `${"0".repeat(64)}  snagentic-linux-x64\n${sum}  snagentic-macos-arm64\n`;
    expect(expectedSum(sums, "snagentic-macos-arm64")).toBe(sum);
    expect(expectedSum(sums, "snagentic-windows-x64.exe")).toBeNull();
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("upgrade steps in release notes", () => {
  const notes = [
    "### ⚠️ Breaking: credentials are bound to their instance",
    "",
    "Run `snagentic auth login <name>` once per instance.",
    "",
    "### Added",
    "",
    "- something new",
  ].join("\n");

  it("keeps only the sections marked with ⚠️, of the releases skipped over", () => {
    const releases = [
      { version: "1.3.0", notes: "### Added\n\n- more" },
      { version: "1.2.0", notes },
      { version: "1.1.0", notes: "### ⚠️ Old step\n\nalready done" },
    ];
    expect(upgradeSteps(releases, "1.1.0", "1.3.0")).toEqual([
      {
        version: "1.2.0",
        sections: [
          "### ⚠️ Breaking: credentials are bound to their instance\n\nRun `snagentic auth login <name>` once per instance.",
        ],
      },
    ]);
  });
});

describe("the update notice", () => {
  const base = { command: "status", format: "text", interactive: true, env: {} };

  it("shows only to a person at a terminal, after an ordinary command", () => {
    expect(noticeAllowed(base)).toBe(true);
    expect(noticeAllowed({ ...base, interactive: false })).toBe(false);
    expect(noticeAllowed({ ...base, format: "json" })).toBe(false);
    expect(noticeAllowed({ ...base, format: "agent" })).toBe(false);
    for (const command of ["mcp", "hook", "upgrade", "help", "--version", "-h", undefined]) {
      expect(noticeAllowed({ ...base, command })).toBe(false);
    }
  });

  it("stays quiet in CI and when turned off", () => {
    expect(noticeAllowed({ ...base, env: { CI: "true" } })).toBe(false);
    expect(noticeAllowed({ ...base, env: { SNAGENTIC_NO_UPDATE_CHECK: "1" } })).toBe(false);
  });

  it("asks GitHub at most once a day", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(checkDue(null, now)).toBe(true);
    expect(checkDue("2026-10-08T00:00:01Z", now)).toBe(false);
    expect(checkDue("2026-10-07T11:59:59Z", now)).toBe(true);
    expect(checkDue("not a date", now)).toBe(true);
  });
});
