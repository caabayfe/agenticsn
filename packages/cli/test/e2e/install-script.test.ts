import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../../../scripts/install/install.sh");
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function target(): string | null {
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  if (process.platform === "linux") return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
  return null;
}

// A release folder with a stand-in binary and its checksums.
async function release(tamper = false) {
  const base = await mkdtemp(join(tmpdir(), "snagentic-release-"));
  temporary.push(base);
  const name = `snagentic-${target()}`;
  const binary = "#!/bin/sh\necho snagentic 1.0.0\n";
  await writeFile(join(base, name), binary);
  const sum = createHash("sha256")
    .update(tamper ? "something else" : binary)
    .digest("hex");
  await writeFile(join(base, "SHA256SUMS"), `${sum}  ${name}\n`);
  const installDir = join(base, "bin");
  return { base, installDir };
}

async function run(base: string, installDir: string) {
  const child = Bun.spawn(["sh", SCRIPT], {
    env: {
      ...process.env,
      SNAGENTIC_DOWNLOAD_BASE: `file://${base}`,
      SNAGENTIC_INSTALL_DIR: installDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
}

describe.skipIf(target() === null)("install.sh", () => {
  it("installs the release binary after checking its checksum", async () => {
    const { base, installDir } = await release();
    const { out, code } = await run(base, installDir);
    expect(code).toBe(0);
    expect(out).toContain(`installed snagentic in ${installDir}`);
    expect(await readFile(join(installDir, "snagentic"), "utf8")).toContain("snagentic 1.0.0");
    expect((await stat(join(installDir, "snagentic"))).mode & 0o111).not.toBe(0);
  });

  it("installs nothing when the checksum does not match", async () => {
    const { base, installDir } = await release(true);
    const { err, code } = await run(base, installDir);
    expect(code).not.toBe(0);
    expect(err).toContain("does not match SHA256SUMS; nothing was installed");
    await expect(stat(join(installDir, "snagentic"))).rejects.toThrow();
  });
});
