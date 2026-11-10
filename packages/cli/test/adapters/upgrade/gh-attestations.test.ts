import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhAttestations } from "../../../src/adapters/upgrade/gh-attestations";
import { fakeProgram } from "../../support/fake-program";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const signal = new AbortController().signal;
const BINARY = new TextEncoder().encode("snagentic 2.7.0 binary");
const EXIT_0 = "process.exit(0);";
const EXIT_1 = "process.exit(1);";

// A stand-in for the GitHub CLI: logs its arguments and the verified file's content, then
// answers `auth status` and `attestation verify` with the given snippets (TypeScript).
async function fakeGh(auth: string, verify: string) {
  const dir = await mkdtemp(join(tmpdir(), "snagentic-gh-"));
  cleanups.push(dir);
  const log = join(dir, "calls.log");
  const script = await fakeProgram(
    dir,
    "gh",
    [
      'import { appendFileSync, copyFileSync } from "node:fs";',
      "const args = process.argv.slice(2);",
      `appendFileSync(${JSON.stringify(log)}, \`\${args.join(" ")}\\n\`);`,
      `if (args[0] === "auth") { ${auth} }`,
      `copyFileSync(args[2] ?? "", ${JSON.stringify(join(dir, "seen"))});`,
      verify,
    ].join("\n"),
  );
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n");
  const seen = () => readFile(join(dir, "seen"), "utf8");
  return { gh: new GhAttestations(script), calls, seen };
}

describe("GhAttestations (ADR-0043)", () => {
  it("verifies the binary was built by the release workflow from the version's tag", async () => {
    const { gh, calls, seen } = await fakeGh(EXIT_0, EXIT_0);
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
    const { gh } = await fakeGh(
      EXIT_0,
      "console.error('Error: HTTP 404: Not Found');\nprocess.exit(1);",
    );
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
    const { gh, calls } = await fakeGh(EXIT_1, EXIT_0);
    expect(await gh.verify(BINARY, "2.7.0", signal)).toEqual({
      status: "unchecked",
      reason: "gh is not signed in (gh auth login)",
    });
    expect(await calls()).toEqual(["auth status"]);
  });

  it("leaves no copy of the binary behind", async () => {
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith("snagentic-attest-"));
    const { gh } = await fakeGh(EXIT_0, EXIT_1);
    await gh.verify(BINARY, "2.7.0", signal).catch(() => undefined);
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith("snagentic-attest-"));
    expect(after).toEqual(before);
  });
});
