# Incident delivery CLI integration verification

**Continuation:** owner authorized GitHub pushes, pdi12 install/browser end-to-end and merges
conditional on success. This branch is pushed in [#274](https://github.com/caabayfe/agenticsn/pull/274).
The integrated candidate completed pdi12 zero-data install `1ba4f0fa857fbea9`, report
`c684ba9d241f45fedd09df47bac300d9078c1835`: instance already as built, no metadata reload,
no activations, zero rows, 26/26 layouts/forms. GitHub verify run `43843028262` / 837 passed on
initial head `3cca67fb`. Browser ordinary resolution/closure, actual SOW refused-save/reload,
non-admin MIM manager native Publish and caller Close visibility in classic/SOW passed. The
manager's final native Close awaits renewed browser sign-in; merge remains gated on it and
the final head's checks. No release, tag or installed CLI upgrade has occurred. Earlier no-push
and no-integrated-live statements below describe the prior checkpoint.

## Candidate

- Branch: `fix/incident-delivery-integration`, worktree `snagentic20-sla-capture`.
- Integration commit: `d80f86e76ed5ba1c4dee892c0137ae2537b08b79`.
- Parents: tested SLA/recovery candidate `d9c09dab3559d9cb9592f9bb52fd81533bd6cbd8`
  and current main `e268fe907301158ee070c999a5c6861e6791e1ab` (2.22.0).
- Includes existing recovery commit `23e97179` (#270) and SLA capture commit `d9c09dab` (#272).
  #270 is closed without merge; #272 remains based on its branch. This local integration is a
  proposed replacement delivery branch, not a change to either remote PR's status.
- Main merged cleanly into the delivery code. The changelog conflict preserves both the two
  Unreleased fixes and the 2.22.0 release entry. The command reference was regenerated from the
  combined registry, preserving current help and both recovery flags.

## Verification

`bun run verify` on Bun 1.4.4 passed with **2,845 passed, 12 skipped, zero failures** and 42,625
assertions. Typecheck, lint, architecture, size and unchanged coverage gates pass. Existing
recovery and native-trigger-contract regression tests run with the current main's CLI/MCP changes.

The first run under the outer filesystem/process sandbox failed host-dependent keychain,
system-voice, localhost-server, browser and SDK-worker tests. They were not changed or skipped:
the full host-access run passed. Log `/tmp/incident-cli-integration-verify-host.log`.

Standalone build:

```text
bun scripts/build.ts --outfile /tmp/snagentic-incident-delivery-candidate
```

- Binary: 224.4 MB; reported version `snagentic 2.22.0` (an unreleased local candidate).
- SHA256: `1d38a54790762210d288e06b10431092440cecb29b70207bef829a086d94fdf9`.
- `plan-push --help` and `push --help` both expose `--recover-pending` with the current help
  formatting, effects and examples.
- Embedded SDK worker: offline subflow fixture in `/tmp/incident-cli-sdk-smoke`, bound to
  `ci.invalid`, builds five units and validates with zero blocks/warnings/information. The final
  host-access smoke starts the native worker sandbox without the outer-sandbox fallback warning.
  No instance is contacted. SN-UPG-002 remains explicitly unchecked because this offline fixture
  has no customization inventory.
- Build and smoke logs: `/tmp/incident-cli-integration-build.log`,
  `/tmp/incident-cli-sdk-smoke-host-result.json`, `/tmp/incident-cli-sdk-smoke-host.stderr`.

## Delivery limits

No new live recovery was manufactured. The existing pdi12 record-only recovery and normal-install
evidence for `23e97179`/`d9c09dab` remains the runtime evidence; the integrated candidate has local
regression, standalone-build and offline embedded-worker proof only. No delivery safeguard,
capture comparison, journal or ledger was bypassed.

The original `dist/snagentic` remains byte-identical to the pdi12 SLA candidate
(`ab1cc3173d10c6cbddcf2feddc6657cd51764c3d9617c883c3c093dbcaab4edc`), so the concurrent
accelerator install continued using the same verified binary. No installed CLI was replaced.

The owner was asked to approve pushing this integration to `caabayfe/agenticsn` and opening a
separate draft PR. No push, remote PR update, merge, version bump, tag or release has occurred.
After review, choose the release version through the normal release workflow and validate its
version/lockfile/package metadata; do not publish this 2.22.0 candidate over an existing release.
