import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutableBinary, installedPath } from "../../../src/adapters/upgrade/executable-binary";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// Stand-ins for a release binary: a script that reports its version.
const script = (version: string) =>
  new TextEncoder().encode(`#!/bin/sh\necho "snagentic ${version} (test)"\necho "args: $*"\n`);

async function installed(name = "snagentic") {
  const dir = await mkdtemp(join(tmpdir(), "snagentic-binary-"));
  folders.push(dir);
  const path = join(dir, name);
  await writeFile(path, script("1.2.1"));
  await chmod(path, 0o755);
  return { dir, path };
}

describe("ExecutableBinary (ADR-0023)", () => {
  it("swaps in a new binary once it runs and reports the expected version", async () => {
    const { path } = await installed();
    const binary = new ExecutableBinary(path, "darwin");
    await binary.replace(script("1.3.0"), "1.3.0");
    expect(await readFile(path, "utf8")).toContain("snagentic 1.3.0");
    expect((await stat(path)).mode & 0o111).not.toBe(0);
    const ran = await binary.run(["agent", "install"], tmpdir());
    expect(ran).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("args: agent install"),
    });
  });

  it("keeps the installed binary when the new one reports another version", async () => {
    const { dir, path } = await installed();
    await expect(
      new ExecutableBinary(path, "darwin").replace(script("1.1.0"), "1.3.0"),
    ).rejects.toMatchObject({ code: "binary-not-replaced" });
    expect(await readFile(path, "utf8")).toContain("snagentic 1.2.1");
    const left = await Array.fromAsync(
      new Bun.Glob(".snagentic-upgrade*").scan({ cwd: dir, dot: true }),
    );
    expect(left).toEqual([]);
  });

  it("on Windows moves the running file aside first, and clears it on the next upgrade", async () => {
    const { path } = await installed("snagentic.exe");
    const binary = new ExecutableBinary(path, "win32");
    await binary.replace(script("1.3.0"), "1.3.0");
    expect(await readFile(path, "utf8")).toContain("snagentic 1.3.0");
    expect(await readFile(`${path}.old`, "utf8")).toContain("snagentic 1.2.1");
    await binary.replace(script("1.4.0"), "1.4.0");
    expect(await readFile(`${path}.old`, "utf8")).toContain("snagentic 1.3.0");
  });

  it("knows a release binary from snagentic run from source", () => {
    expect(installedPath("/usr/local/bin/snagentic")).toBe("/usr/local/bin/snagentic");
    expect(installedPath("C:\\Tools\\snagentic.exe")).toBe("C:\\Tools\\snagentic.exe");
    expect(installedPath("/opt/homebrew/bin/bun")).toBeNull();
  });
});
