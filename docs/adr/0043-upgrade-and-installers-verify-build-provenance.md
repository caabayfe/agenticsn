# 0043. `upgrade` and the installers verify where a release was built

- Status: Proposed (2026-10-23)
- Date: 2026-10-23
- Requirements: ASR-05
- Amends: 0023 (item 1, what `upgrade` checks)
- Relates to: 0011 (enforcement layers)
- Plan: `specs/012-security-hardening/plan.md` (step 4, audit finding A-04)

## Context

`snagentic upgrade`, `install.sh` and `install.ps1` download a binary and `SHA256SUMS` from the
same GitHub release and check one against the other. ADR-0023 already says what that proves: the
binary is the one published with the release, not who built it. Anyone who can change a
release's files can change both.

Since 1.0.0 the release workflow also attests build provenance
(`actions/attest-build-provenance`): a Sigstore-signed statement, without a key we keep, that a
binary with this digest was built by `.github/workflows/release.yml` in `caabayfe/agenticsn`
from a given tag. Every release from 1.0.0 to 2.6.0 has one. Nothing checks it yet.

Checking it today needs the GitHub CLI (`gh attestation verify`), signed in: GitHub serves
attestations only to authenticated requests. Most snagentic users have `gh` (pull requests use
it), but not all, and not in every container.

## Decision

1. **`upgrade` verifies provenance after the checksum and before running the new binary.** It
   runs `gh attestation verify` on the downloaded file and requires all of: repository
   `caabayfe/agenticsn`, signer workflow `caabayfe/agenticsn/.github/workflows/release.yml`,
   and source ref `refs/tags/v<version>`, so a binary built from another tag or workflow is
   refused.
2. **When `gh` can check, a failure refuses.** Nothing is replaced, and the error says to report
   it. There is no flag to skip it.
3. **When `gh` can't check, `upgrade` goes on and says so.** No `gh` on the PATH, or `gh` not
   signed in: the upgrade proceeds on the checksum, as before this ADR, and its output says
   provenance was not checked and why, with the command to check it by hand.
4. **The installers do the same.** `install.sh` and `install.ps1` verify with `gh` when it is
   installed and signed in, refuse on a failure, and otherwise print one line saying provenance
   was not checked.
5. **No signing key of our own, for now.** `SHA256SUMS` is not signed with minisign or cosign.

## Consequences

- With `gh` signed in, a tampered release file is refused even when its `SHA256SUMS` was changed
  to match: the attacker would also need to run the release workflow on a tag.
- Without `gh`, nothing changes, but the user is told. Verification without `gh` would need a
  Sigstore verifier inside the binary (a new dependency, ADR-0005) or our own signing key.
- `upgrade --to` an older release works: every release since 1.0.0 has an attestation.
- The `gh` call goes to github.com, outside the instance request scheduler, like the release
  downloads (ADR-0023).
- Homebrew keeps checking the formula's SHA-256 only.

## Alternatives considered

- **Sign `SHA256SUMS` with a key shipped in the binary (minisign or cosign).** Verifies without
  `gh`, but someone has to keep the private key safe, rotate it, and put it in CI as a secret
  that can sign releases. With one maintainer that is a new single point of failure. Revisit if
  users without `gh` need verification, or when Sigstore verification can be done in the binary
  without a large dependency.
- **Refuse to upgrade without `gh`.** Safer, but it breaks upgrades on machines that installed
  snagentic without `gh` and gains little: the person can still download the binary by hand.
  It could become an opt-in setting later.
- **Verify the attestation bundle ourselves.** Needs the Sigstore trust root and certificate
  chain checks: too much security-sensitive code to own for this.
