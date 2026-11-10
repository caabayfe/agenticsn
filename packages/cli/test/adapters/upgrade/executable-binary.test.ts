import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutableBinary, installedPath } from "../../../src/adapters/upgrade/executable-binary";
import { compiledProgram } from "../../support/fake-program";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// Compiling and first starting a stand-in takes seconds where the OS scans new executables.
const BINARY_TIMEOUT = 60_000;

// Stand-ins for a release binary: an executable that reports its version, compiled so that it
// runs on Windows too.
const script = (version: string) =>
  compiledProgram(
    `console.log("snagentic ${version} (test)");\nconsole.log(\`args: \${process.argv.slice(2).join(" ")}\`);\n`,
  );

async function installed(name = "snagentic") {
  const dir = await mkdtemp(join(tmpdir(), "snagentic-binary-"));
  folders.push(dir);
  const path = join(dir, name);
  await writeFile(path, await script("1.2.1"));
  await chmod(path, 0o755);
  return { dir, path };
}

describe("ExecutableBinary (ADR-0023)", () => {
  it(
    "swaps in a new binary once it runs and reports the expected version",
    async () => {
      const { path } = await installed();
      const binary = new ExecutableBinary(path, "darwin");
      await binary.replace(await script("1.3.0"), "1.3.0");
      expect(await readFile(path, "utf8")).toContain("snagentic 1.3.0");
      // Windows has no mode bits; the run below shows the binary starts there.
      if (process.platform !== "win32") expect((await stat(path)).mode & 0o111).not.toBe(0);
      const ran = await binary.run(["agent", "install"], tmpdir());
      expect(ran).toMatchObject({
        exitCode: 0,
        stdout: expect.stringContaining("args: agent install"),
      });
    },
    BINARY_TIMEOUT,
  );

  it(
    "keeps the installed binary when the new one reports another version",
    async () => {
      const { dir, path } = await installed();
      await expect(
        new ExecutableBinary(path, "darwin").replace(await script("1.1.0"), "1.3.0"),
      ).rejects.toMatchObject({ code: "binary-not-replaced" });
      expect(await readFile(path, "utf8")).toContain("snagentic 1.2.1");
      const left = await Array.fromAsync(
        new Bun.Glob(".snagentic-upgrade*").scan({ cwd: dir, dot: true }),
      );
      expect(left).toEqual([]);
    },
    BINARY_TIMEOUT,
  );

  it(
    "on Windows moves the running file aside first, and clears it on the next upgrade",
    async () => {
      const { path } = await installed("snagentic.exe");
      const binary = new ExecutableBinary(path, "win32");
      await binary.replace(await script("1.3.0"), "1.3.0");
      expect(await readFile(path, "utf8")).toContain("snagentic 1.3.0");
      expect(await readFile(`${path}.old`, "utf8")).toContain("snagentic 1.2.1");
      await binary.replace(await script("1.4.0"), "1.4.0");
      expect(await readFile(`${path}.old`, "utf8")).toContain("snagentic 1.3.0");
    },
    BINARY_TIMEOUT,
  );

  it("refuses to replace or run itself when snagentic runs from source", async () => {
    const binary = new ExecutableBinary(null, "darwin");
    await expect(binary.replace(await script("1.3.0"), "1.3.0")).rejects.toMatchObject({
      code: "binary-not-replaced",
    });
    expect(() => binary.run(["--version"], tmpdir())).toThrow("not an installed release");
  });

  it("reports a binary it could not write as not replaced, with the reason", async () => {
    const { dir } = await installed();
    const path = join(dir, "gone", "snagentic");
    await expect(
      new ExecutableBinary(path, "darwin").replace(await script("1.3.0"), "1.3.0"),
    ).rejects.toMatchObject({
      code: "binary-not-replaced",
      message: expect.stringContaining("ENOENT"),
    });
  });

  it("knows a release binary from snagentic run from source", () => {
    expect(installedPath("/usr/local/bin/snagentic")).toBe("/usr/local/bin/snagentic");
    expect(installedPath("C:\\Tools\\snagentic.exe")).toBe("C:\\Tools\\snagentic.exe");
    expect(installedPath("/opt/homebrew/bin/bun")).toBeNull();
  });
});
