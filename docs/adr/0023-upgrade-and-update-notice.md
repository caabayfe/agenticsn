# 0023. `snagentic upgrade` and an update notice, with no silent self-update

- Status: Accepted
- Date: 2026-10-08
- Requirements: ASR-05
- Relates to: 0004 (deployment topology), 0011 (enforcement layers), 0012 (production read-only)

## Context

Upgrading takes three manual steps that nothing prompts: run the install script again, run
`snagentic agent install` again in each workspace so the pack matches the binary, and read the
changelog for steps such as the `auth login` that 1.2.0 required. Users miss releases, and
miss the steps when they do upgrade.

A silent self-update would remove the steps but is wrong for this tool:

- a release with an upgrade step (1.2.0) would break every machine at once, in the middle of
  an agent's session, with no one told why;
- a binary that holds instance credentials and writes to instances would rewrite itself from
  the internet: a compromised release would reach every machine at once, and releases are not
  code-signed yet;
- what a command does would change under a running agent.

The owner chose an explicit upgrade command and a notice, and no version pin per workspace.

## Decision

1. **`snagentic upgrade [--version <x.y.z>]`, run by a person.** It downloads the release's
   binary for this platform and `SHA256SUMS` from the project's GitHub releases over HTTPS,
   refuses unless the binary's SHA-256 matches, checks that the new binary runs and reports
   the expected version, and only then replaces the running executable in place (an atomic
   rename next to it; on Windows the running file is renamed aside first). Without
   `--version` it installs the latest release and does nothing when already current;
   `--version` also allows going back. A binary not installed from a release (run from
   source) is refused.
2. **It finishes the upgrade in the workspace.** Run inside a workspace whose agent pack is
   installed, it runs the new binary's `agent install` and lists the files to commit. It
   prints the upgrade steps (`### ⚠️` sections) of every release it skipped over, from the
   release notes.
3. **An update notice, at most once a day.** After a command, snagentic asks GitHub for the
   latest release when its last check is over a day old (cached in the user's cache folder),
   with a short timeout, and prints one line on standard error when a newer one exists:
   `snagentic <version> is available: run snagentic upgrade`. It never prints in MCP, hook,
   agent or JSON output, when standard error is not a terminal, in CI (`CI` set), or with
   `SNAGENTIC_NO_UPDATE_CHECK=1`. A failed check is silent and waits a day. The request
   carries no workspace, instance or user data; GitHub sees only that a copy checked.
4. **Agents do not upgrade.** `upgrade` is not an MCP tool, the Claude Code deny rules and the
   pre-shell hook refuse `snagentic upgrade`: the binary an agent runs changes only when a
   person decides.
5. **No version pin.** The owner declined a minimum version per workspace; `doctor` keeps
   warning when the installed pack is from another version.

## Consequences

- Upgrading is one command; the notice tells people when to run it.
- GitHub requests (one a day for the notice, a few for an upgrade) go to github.com, never
  through the instance's request scheduler, which is for instances (ADR-0016).
- The checksum proves the binary is the one published with the release, not who published it.
  Code signing (deferred) or provenance verification can strengthen it later without changing
  the command.
- Windows replacement is covered by unit tests only until it runs on a Windows machine.
