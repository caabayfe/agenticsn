import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Provenance, ProvenanceMismatchError, type ProvenanceVerifier } from "@snagentic/core";
import { GH_NOT_INSTALLED, ghReason, runGh } from "../run-gh";

const REPOSITORY = "caabayfe/agenticsn";
const WORKFLOW = `${REPOSITORY}/.github/workflows/release.yml`;

// A release binary's build provenance, checked with the GitHub CLI (ADR-0043): GitHub's
// Sigstore attestation must name this repository, the release workflow and the version's tag.
// GitHub serves attestations only to signed-in requests, so without gh, or signed out, the
// binary can't be checked here.
export class GhAttestations implements ProvenanceVerifier {
  constructor(
    readonly executable = "gh",
    private readonly timeoutMs = 60_000,
  ) {}

  async verify(binary: Uint8Array, version: string, signal: AbortSignal): Promise<Provenance> {
    const run = { executable: this.executable, cwd: tmpdir(), timeoutMs: this.timeoutMs, signal };
    const auth = await runGh(["auth", "status"], run);
    if (auth === null) {
      return { status: "unchecked", reason: GH_NOT_INSTALLED };
    }
    if (auth.exitCode !== 0) {
      return { status: "unchecked", reason: "gh is not signed in (gh auth login)" };
    }
    const dir = await mkdtemp(join(tmpdir(), "snagentic-attest-"));
    try {
      const file = join(dir, "snagentic");
      await writeFile(file, binary);
      const args = ["attestation", "verify", file, "--repo", REPOSITORY];
      const checks = ["--signer-workflow", WORKFLOW, "--source-ref", `refs/tags/v${version}`];
      const verified = await runGh([...args, ...checks], run);
      if (verified === null || verified.exitCode !== 0) {
        throw new ProvenanceMismatchError(
          version,
          verified === null ? GH_NOT_INSTALLED : ghReason(verified),
        );
      }
      return { status: "verified" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
