# 0055. The SDK worker on Windows: a sandbox in two steps, low integrity first

- Status: Accepted (product owner, 2026-11-11). Step 1 is built (spec 014, stage 1b;
  release 2.20.0); step 2 is not built.
- Date: 2026-11-10
- Requirements: ASR-02, ASR-03, ASR-08, ASR-15
- Amends: 0044 (item 6, Windows)
- Relates to: 0011 (enforcement layers), 0023 (upgrade), 0028 (the embedded SDK)
- Evidence: spec 014, stage 1b (Windows support); re-audit finding SEC2-04. Read on `main`
  b0c2e678: `packages/cli/src/adapters/fluent/worker-sandbox.ts` wraps the worker only on macOS
  (`sandbox-exec`); on Windows `osSandbox` returns the command unchanged and `isolation: none`.

## Context

ADR-0044 runs the Fluent SDK in a worker: the snagentic binary started again, with no credential
and an allow-listed environment. Item 6 adds an operating-system sandbox where one exists: on
macOS no network and no writes outside the build copy and the worker's scratch folder. For
Windows it says "no sandbox, the worker only". Spec 014 now wants snagentic to genuinely work on
Windows x64, for developers and in CI, so that line needs a decision instead of a gap.

What a Windows sandbox would have to give, to match item 6:

1. **no writes** outside the build copy and the scratch folder;
2. **no network**;
3. it starts from the snagentic binary with no administrator rights, no installed driver or
   service, and no setting left on the machine;
4. if it can't start, the worker runs without it and says so once (item 6), and `doctor` reports
   the level;
5. it is tested on the Windows CI runner, as the macOS sandbox is on the macOS runner.

The worker today is started with `Bun.spawn` and talks to the main process over Bun's IPC
channel. `Bun.spawn` can't pass a token, a job or `SECURITY_CAPABILITIES`; anything below that
does needs Win32 calls through `bun:ffi` (supported on Windows) and, for some options, a
different channel to the worker.

## Options

| | What it stops | How it starts | Cost | Risks |
|---|---|---|---|---|
| **A. Low integrity + job object** | Writes to anything labelled medium integrity: the user's profile, the workspace, other projects (no-write-up). Not reads, not the network. The job kills the worker with snagentic and can forbid child processes | The worker lowers its own token to low integrity (`SetTokenInformation`, `TokenIntegrityLevel`) through `bun:ffi` before it loads the SDK. The main process labels the build copy and the scratch folder low (`SetNamedSecurityInfo`, or `icacls /setintegritylevel low`) and puts the worker in a job (`CreateJobObject`, `AssignProcessToJobObject`, kill on close, one active process) | Small: about 2–4 days with tests. `Bun.spawn` and the IPC channel stay | Bun's runtime must keep working at low integrity (its temp and cache folders must be the low ones it is given); the self-lowering happens inside the process it protects, so it must run before any project file is read |
| **B. AppContainer** | Network (no `internetClient` capability), writes **and reads** outside the folders granted to the container's SID, the registry, other processes | `CreateAppContainerProfile`, then `CreateProcessW` with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`, through `bun:ffi`. The binary, the build copy and the scratch folder get an ACL entry for the container SID | Large: about 2 weeks. Needs its own process start, its own pipes for the worker protocol (Bun's IPC channel is not available), ACL changes on the installed binary, and profile clean-up | Whether Bun's runtime runs in an AppContainer at all is unknown (spike first). ACL entries on the user's files are machine state; a crash may leave a profile behind |
| **C. Firewall rule for the worker** | Network only | `New-NetFirewallRule` / WFP filters, per program path | Medium | Needs administrator rights and leaves system state (fails requirement 3); a rule is per executable path, and the worker is the snagentic binary itself, so it would also cut the main process off unless the worker runs from a copy of the 250 MB binary; enterprise firewall policy can override it |
| **D. Restricted token** (`CreateRestrictedToken`, deny-only SIDs, no privileges) | Access granted only through the removed groups; with care, writes | `CreateProcessAsUserW` through `bun:ffi` | Medium: its own process start and pipes, as B | Easy to get wrong: a restricted token alone still reads and writes most of what the user can; it is what Chromium combines with A, a job and a separate desktop |
| **E. Windows Sandbox or a Hyper-V container** | Everything | A virtual machine | Large, and an optional feature | Not on Windows Home, not on CI runners, slow to start: rejected |
| **F. Keep "no sandbox"** | Nothing beyond ADR-0044 items 1–5 | — | None | The worker can write anywhere the user can and reach the network: the macOS promise doesn't hold on Windows |

ADR-0044's first lines stay true under every option: the worker holds no credential and gets a
fixed environment; the main process re-checks every instance request and the worker's answer.

## Decision

1. **Until step 1 ships:** Windows stays at "worker only" (option F), and the documentation says
   so where it names the platform: README and the product overview. `snagentic doctor` says it
   (`in a worker with no credential (no sandbox on this system)`).
2. **Step 1, option A:** the worker runs at low integrity inside a job object. This meets
   requirement 1 (writes) and 3–5, not 2 (network). `doctor` and the build report the level as
   `low-integrity`. If lowering or the job fails, the worker runs without it and says so once.
3. **Step 2, option B, after a spike:** a spike checks that the snagentic binary runs its worker
   in an AppContainer (start-up, the embedded SDK's file reads, the worker protocol over pipes,
   a build of the Fluent fixtures). If it passes, AppContainer replaces A on Windows and meets
   requirement 2 as well; if not, A stays and the network gap is documented.
4. Options C, D and E are not built.

### How step 1 is built

- **The worker confines itself**, all of it, before it loads the SDK or reads the project:
  snagentic starts it with the folders it may write (`SNAGENTIC_WORKER_LOW_INTEGRITY_FOLDERS`),
  and the worker, still at medium integrity, labels them low (`SetNamedSecurityInfoW` with
  `S:(ML;OICI;NW;;;LW)`, which also relabels the files already in them), creates a job for itself
  (one active process, kill on close, die on an unhandled exception) and lowers its token
  (`SetTokenInformation`, `TokenIntegrityLevel`). The table above has the main process label the
  folders and create the job; doing it in the worker keeps `bun:ffi` out of the process that holds
  the credential, so a mistake in a Win32 call can only crash the worker.
- The calls go through `bun:ffi` against `kernel32.dll` and `advapi32.dll`: system libraries, no
  native add-on and no helper binary (ADR-0005).
- The job is the worker's own: it stops the worker starting any program, and kill-on-close only
  covers processes in it. That the worker ends with snagentic stays as before: it exits when the
  IPC channel closes, and snagentic stops it when a build ends or is cancelled.
- If any call fails, the worker exits before `ready`; snagentic starts it again without the
  sandbox and says so once (ADR-0044, item 6). `doctor` reports `at low integrity (no writes
  outside the build; network open)`.
- Only the build copy and the scratch folder are labelled, and both are temporary folders snagentic
  deletes after the build: nothing is left on the machine.

## Consequences

- Step 1 closes the write half of SEC2-04 on Windows at small cost and keeps the worker's start
  and channel as they are. A worker that runs project code through a route nobody found can't
  change the workspace, other repositories or the user's profile; it can still read them and
  reach the network, as on Linux today.
- Step 2 would put Windows on par with macOS (and beyond it on reads), at the price of a second
  way to start the worker and ACL entries the install has to own.
- Tests: the Windows CI runner gets the sandbox tests the macOS runner has (a worker that tries
  to write outside its folders fails; with step 2, one that opens a socket fails), and a guard
  that they ran, as `the macOS sandbox tests ran` does.
- Until step 1 ships, the Windows documentation names the gap.

## Alternatives considered

The options table above. Doing nothing (F) is the current state and the fallback of every other
option; it is not chosen as the end state because spec 014 asks for Windows as a supported
platform, and ADR-0044 item 6 promises a sandbox "where the operating system allows it", which
Windows does without administrator rights (A, B).
