# S3. Single binary on every platform

- Date: 2026-10-05
- Confirms: ADR-0005 (TypeScript compiled with Bun), ASR-05
- Verdict: **go for macOS arm64, Windows x64, Linux x64 and Linux arm64.
  macOS x64 (Intel) unsupported** (see decisions).

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

## Decisions (product owner, 2026-10-05)

1. **macOS x64 (Intel) is unsupported.** No Intel Mac is available to tell a CI-image
   problem from a product problem. The CI job keeps running, allowed to fail, so a fix in
   the image or the add-on becomes visible. Support can be added later by anyone who
   verifies `snagentic doctor` on real Intel hardware.
2. **No separate start-up target.** The spec's < 100 ms start-up criterion is retired.
   Start-up is measured as part of ASR-04 (post-edit check < 300 ms p95 end to end),
   which is what users experience. On developer hardware start-up is about 31 ms.
