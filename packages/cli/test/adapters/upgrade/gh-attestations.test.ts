import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhAttestations } from "../../../src/adapters/upgrade/gh-attestations";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const signal = new AbortController().signal;
const BINARY = new TextEncoder().encode("snagentic 2.7.0 binary");

// A stand-in for the GitHub CLI: logs its arguments and the verified file's content, then
// answers `auth status` and `attestation verify` with the given snippets.
async function fakeGh(auth: string, verify: string) {
  const dir = await mkdtemp(join(tmpdir(), "snagentic-gh-"));
  cleanups.push(dir);
  const log = join(dir, "calls.log");
  const script = join(dir, "gh");
  await writeFile(
    script,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${log}"`,
      `if [ "$1" = auth ]; then ${auth}; fi`,
      `cat "$3" > "${dir}/seen"`,
      verify,
    ].join("\n"),
  );
  await chmod(script, 0o755);
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n");
  const seen = () => readFile(join(dir, "seen"), "utf8");
  return { gh: new GhAttestations(script), calls, seen };
}

describe("GhAttestations (ADR-0043)", () => {
  it("verifies the binary was built by the release workflow from the version's tag", async () => {
    const { gh, calls, seen } = await fakeGh("exit 0", "exit 0");
    expect(await gh.verify(BINARY, "2.7.0", signal)).toEqual({ status: "verified" });
    const [auth, verify] = await calls();
    expect(auth).toBe("auth status");
    expect(verify).toMatch(/^attestation verify \S+ /);
    expect(verify).toEndWith(
      "--repo caabayfe/agenticsn " +
        "--signer-workflow caabayfe/agenticsn/.github/workflows/release.yml " +
        "--source-ref refs/tags/v2.7.0",
    );
    expect(await seen()).toBe("snagentic 2.7.0 binary");
  });

  it("refuses when gh checks and the attestation does not match", async () => {
    const { gh } = await fakeGh("exit 0", "echo 'Error: HTTP 404: Not Found' >&2; exit 1");
    await expect(gh.verify(BINARY, "2.7.0", signal)).rejects.toMatchObject({
      code: "provenance-mismatch",
      message: expect.stringContaining("Error: HTTP 404: Not Found"),
    });
  });

  it("can't check when gh is missing or not signed in, and says which", async () => {
    const missing = new GhAttestations("/nonexistent/gh");
    expect(await missing.verify(BINARY, "2.7.0", signal)).toEqual({
      status: "unchecked",
      reason: "the GitHub CLI (gh) is not installed",
    });
    const { gh, calls } = await fakeGh("exit 1", "exit 0");
    expect(await gh.verify(BINARY, "2.7.0", signal)).toEqual({
      status: "unchecked",
      reason: "gh is not signed in (gh auth login)",
    });
    expect(await calls()).toEqual(["auth status"]);
  });

  it("leaves no copy of the binary behind", async () => {
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith("snagentic-attest-"));
    const { gh } = await fakeGh("exit 0", "exit 1");
    await gh.verify(BINARY, "2.7.0", signal).catch(() => undefined);
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith("snagentic-attest-"));
    expect(after).toEqual(before);
  });
});
