import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compiledProgram } from "../support/fake-program";

// install.ps1 on Windows (install-script.test.ts covers install.sh): a release folder served
// over local HTTP, the script run by PowerShell, the machine's own gh kept out of the way.
const SCRIPT = join(import.meta.dir, "../../../../scripts/install/install.ps1");
const TARGET = "snagentic-windows-x64.exe";
const TIMEOUT = 60_000;
const temporary: string[] = [];
const servers: { stop: (force?: boolean) => void }[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const binary = (version: string) =>
  compiledProgram(
    `if (process.argv.includes("--wait")) await Bun.sleep(30_000);\nconsole.log("snagentic ${version}");\n`,
  );

async function release(version: string, tamper = false) {
  const base = await mkdtemp(join(tmpdir(), "snagentic-release-"));
  temporary.push(base);
  const files = join(base, "files");
  await mkdir(files);
  const bytes = await binary(version);
  await writeFile(join(files, TARGET), bytes);
  const sum = createHash("sha256")
    .update(tamper ? "something else" : bytes)
    .digest("hex");
  await writeFile(join(files, "SHA256SUMS"), `${sum}  ${TARGET}\n`);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => new Response(Bun.file(join(files, new URL(request.url).pathname))),
  });
  servers.push(server);
  return { base, url: `http://127.0.0.1:${server.port}`, installDir: join(base, "bin") };
}

// A stand-in gh.cmd first on the PATH: PowerShell finds it by PATHEXT. `auth` and `verify` are
// the exit codes of `gh auth status` and `gh attestation verify`.
async function fakeGh(base: string, gh: { auth: number; verify: number }) {
  const dir = join(base, "fake-bin");
  await mkdir(dir, { recursive: true });
  const log = join(dir, "calls.log");
  await writeFile(
    join(dir, "gh.cmd"),
    [
      "@echo off",
      `echo %*>> "${log}"`,
      `if "%1"=="auth" exit /b ${gh.auth}`,
      `exit /b ${gh.verify}`,
      "",
    ].join("\r\n"),
  );
  return {
    dir,
    calls: async () =>
      (await readFile(log, "utf8").catch(() => ""))
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim()),
  };
}

async function install(where: Awaited<ReturnType<typeof release>>, gh = { auth: 1, verify: 1 }) {
  const fake = await fakeGh(where.base, gh);
  const child = Bun.spawn(["pwsh", "-NoProfile", "-NonInteractive", "-File", SCRIPT], {
    env: {
      ...process.env,
      PATH: `${fake.dir};${process.env["PATH"] ?? ""}`,
      SNAGENTIC_DOWNLOAD_BASE: where.url,
      SNAGENTIC_INSTALL_DIR: where.installDir,
      SNAGENTIC_VERSION: "1.0.0",
      SNAGENTIC_NO_MODIFY_PATH: "1",
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

const installed = (where: { installDir: string }) => join(where.installDir, "snagentic.exe");

describe.skipIf(process.platform !== "win32")("install.ps1", () => {
  it(
    "installs the release binary after checking its checksum",
    async () => {
      const where = await release("1.0.0");
      const { out, err, code } = await install(where);
      expect({ code, err }).toEqual({ code: 0, err: "" });
      expect(out).toContain(`installed snagentic in ${where.installDir}`);
      expect(out).toContain("provenance not checked");
      const ran = Bun.spawnSync([installed(where)]);
      expect(ran.stdout.toString()).toContain("snagentic 1.0.0");
    },
    TIMEOUT,
  );

  it(
    "installs nothing when the checksum does not match",
    async () => {
      const where = await release("1.0.0", true);
      const { err, code } = await install(where);
      expect(code).not.toBe(0);
      expect(err).toContain("does not match SHA256SUMS");
      expect(await readdir(where.installDir).catch(() => [])).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "verifies provenance against the version's tag when gh is signed in, and refuses a mismatch",
    async () => {
      const where = await release("1.0.0");
      const verified = await install(where, { auth: 0, verify: 0 });
      expect({ code: verified.code, err: verified.err }).toEqual({ code: 0, err: "" });
      expect(verified.out).toContain("provenance verified");
      const [, verify] = await verified.calls();
      expect(verify).toStartWith("attestation verify ");
      expect(verify).toEndWith("--source-ref refs/tags/v1.0.0");
      const other = await release("1.0.0");
      const refused = await install(other, { auth: 0, verify: 1 });
      expect(refused.code).not.toBe(0);
      expect(refused.err).toContain("nothing was installed");
      expect(await readdir(other.installDir).catch(() => [])).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "installs over a snagentic.exe that is still running",
    async () => {
      const where = await release("1.0.0");
      const first = await install(where);
      expect({ code: first.code, err: first.err }).toEqual({ code: 0, err: "" });
      const running = Bun.spawn([installed(where), "--wait"], { stdout: "ignore" });
      try {
        const next = await release("1.1.0");
        const { code, err } = await install({ ...next, installDir: where.installDir });
        expect({ code, err }).toEqual({ code: 0, err: "" });
        const ran = Bun.spawnSync([installed(where)]);
        expect(ran.stdout.toString()).toContain("snagentic 1.1.0");
      } finally {
        running.kill();
        await running.exited;
      }
    },
    TIMEOUT,
  );
});
