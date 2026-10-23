import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

// A stand-in GitHub CLI first on the PATH, so the machine's own gh is never asked: `auth` and
// `verify` are the exit codes of `gh auth status` and `gh attestation verify`.
async function fakeGh(base: string, gh: { auth: number; verify: number }) {
  const dir = join(base, "fake-bin");
  await Bun.write(join(dir, ".keep"), "");
  const log = join(dir, "calls.log");
  const script = join(dir, "gh");
  await writeFile(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n` +
      `if [ "$1" = auth ]; then exit ${gh.auth}; fi\nexit ${gh.verify}\n`,
  );
  await chmod(script, 0o755);
  return {
    dir,
    calls: async () => (await readFile(log, "utf8").catch(() => "")).trim().split("\n"),
  };
}

async function run(base: string, installDir: string, gh = { auth: 1, verify: 1 }) {
  const fake = await fakeGh(base, gh);
  const child = Bun.spawn(["sh", SCRIPT], {
    env: {
      ...process.env,
      PATH: `${fake.dir}:${process.env["PATH"] ?? ""}`,
      SNAGENTIC_DOWNLOAD_BASE: `file://${base}`,
      SNAGENTIC_INSTALL_DIR: installDir,
      SNAGENTIC_VERSION: "1.0.0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code, calls: fake.calls };
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

  it("says provenance was not checked when gh is not signed in", async () => {
    const { base, installDir } = await release();
    const { out, code, calls } = await run(base, installDir);
    expect(code).toBe(0);
    expect(out).toContain("provenance not checked (needs the GitHub CLI, signed in)");
    expect(await calls()).toEqual(["auth status"]);
  });

  it("verifies provenance against the release workflow and tag when gh is signed in", async () => {
    const { base, installDir } = await release();
    const { out, code, calls } = await run(base, installDir, { auth: 0, verify: 0 });
    expect(code).toBe(0);
    expect(out).toContain("provenance verified: built by the release workflow from v1.0.0");
    const verify = (await calls())[1] ?? "";
    expect(verify).toMatch(/^attestation verify \S+\/snagentic /);
    expect(verify).toEndWith(
      "--repo caabayfe/agenticsn --signer-workflow caabayfe/agenticsn/.github/workflows/release.yml " +
        "--source-ref refs/tags/v1.0.0",
    );
  });

  it("installs nothing when gh checks and provenance does not verify", async () => {
    const { base, installDir } = await release();
    const { err, code } = await run(base, installDir, { auth: 0, verify: 1 });
    expect(code).not.toBe(0);
    expect(err).toContain("could not confirm the release workflow built");
    await expect(stat(join(installDir, "snagentic"))).rejects.toThrow();
  });

  it("installs nothing when the checksum does not match", async () => {
    const { base, installDir } = await release(true);
    const { err, code } = await run(base, installDir);
    expect(code).not.toBe(0);
    expect(err).toContain("does not match SHA256SUMS; nothing was installed");
    await expect(stat(join(installDir, "snagentic"))).rejects.toThrow();
  });
});
