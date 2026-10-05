# S3. Single binary on every platform

- Date: 2026-10-05
- Confirms: ADR-0005 (TypeScript compiled with Bun), ASR-05
- Verdict: **go for macOS arm64, Windows x64, Linux x64 and Linux arm64.
  Open issue on macOS x64 (Intel).** Start-up criterion: see "Decision needed".

## Question

Does `bun build --compile` produce one executable per platform that runs `doctor`
(git, OS keychain, SQLite FTS5) without anything else installed, and how fast does it
start?

## Method

The `build` workflow compiles natively on each GitHub-hosted runner and runs
`scripts/measure-s3.ts`: binary size, 20 runs of `--version` for start-up time, and
`doctor --format json`. The figures below come from four runs on 2026-10-05; ranges show
run-to-run variation on shared CI machines.

## Results

| Platform | Runner | Size | Start-up p95 | doctor |
|---|---|---|---|---|
| macOS arm64 | macos-15 | 60 MB | 90–120 ms | ✅ git, keychain, FTS5 |
| macOS x64 | macos-15-intel | 67 MB | 119–424 ms | ❌ keychain (see below) |
| Windows x64 | windows-latest | 84 MB | 77–128 ms | ✅ (Credential Manager works) |
| Linux x64 | ubuntu-24.04 | 84 MB | 48–65 ms | ✅ (runner has a Secret Service) |
| Linux arm64 | ubuntu-24.04-arm | 83 MB | 54–55 ms | ✅ |

For reference, the same macOS arm64 binary on a developer machine (Apple Silicon)
starts in p95 31 ms. Shared CI machines are 2–4× slower.

## Findings

1. **The native keychain add-on is embedded correctly.** It works on 4 of 5 platforms,
   and locally when the binary runs outside the repository.
2. **Bug found and fixed (387a5e9):** on Linux without a Secret Service, creating the
   keychain entry throws. The probe reported this as a failure instead of "unavailable",
   so `doctor` would have failed on every headless Linux server.
3. **Open issue, macOS x64:** every keychain access fails with
   `errSecAuthFailed` ("The user name or passphrase you entered is not correct").
   - Creating, unlocking and selecting a temporary keychain did not change it, nor did
     adding it to the user search list.
   - **Not yet known** whether this is the CI image or a real problem with the x64 build
     of the keychain add-on.
   - **Next step:** run `snagentic doctor` on a real Intel Mac. Until then the
     `macos-x64` job is allowed to fail in CI, and Intel macOS is not a supported
     platform.
   - Context: macOS 26 is the last release Apple ships for Intel Macs, so this platform
     will shrink.

## Decision needed

The spec's start-up criterion (< 100 ms) is met on Linux, mostly met on Windows and
macOS arm64 CI runners, and missed on the Intel runner. On real developer hardware it is
far below (31 ms). The requirement that matters to users is ASR-04 (a post-edit check in
< 300 ms end to end), measured in S5. **Proposal:** retire the separate start-up target
and track start-up as part of ASR-04.
