# 0044. The workspace is untrusted; the SDK runs in a worker that holds no credential

- Status: Accepted (product owner, 2026-10-23)
- Date: 2026-10-23
- Requirements: ASR-02, ASR-03, ASR-08, ASR-15
- Amends: 0032 (item 1, where the SDK runs)
- Relates to: 0011 (enforcement layers), 0016 (instance load), 0028 (the embedded SDK, item 6)
- Spike: `specs/012-security-hardening/spike-sdk-child-process.md`

## Context

snagentic builds what is in the workspace without being asked: the Stop hook, the pre-commit
hook, MCP `validate`, `plan_push` and `push` all run the Fluent SDK on the project. The workspace
can come from a clone, a pull request or an agent's edit, so its content is not trusted.

The SDK runs in snagentic's process (ADR-0032 item 1). That process holds the instance
credential, the `fetch` that signs requests and the user's access to the disk and the network.
In SDK 4.13.6 a project could make the build run its own code (a Prettier config written as
code) and delete folders outside the project (`now.config.json` output folders). #145 refuses
both before the SDK sees the project, but that is a list of the routes we found in one SDK
version. A route we missed, or one a later SDK adds, would run beside the credential.

The spike measured the alternative on macOS:

- a separate process per build adds tens of milliseconds to a build of about a second;
- transform works with the credential left in the parent, because the SDK's requests already go
  through one function (`InstanceExchange`);
- `childEnvironment()` removes snagentic's credentials but keeps other tokens (`GITHUB_TOKEN`,
  cloud credentials), which the SDK doesn't need;
- `sandbox-exec` blocks the network and writes outside the build copy, and the build still
  passes at the same speed.

Linux and Windows were not tested.

## Decision

1. **The workspace is untrusted input.** Project files, `now.config.json`, `package.json` and
   anything else in it may be hostile. The refusals from #145 stay as the first check, before
   any process starts.
2. **The SDK runs in a worker: the snagentic binary started again in a hidden worker mode.**
   - one worker per build or transform, which exits when it answers;
   - the main process never loads the SDK;
   - not `now-sdk`, and nothing else to install;
   - if the worker can't start, the build fails with a hint. It never falls back to running the
     SDK in-process.
3. **The worker holds no credential and gets a fixed environment.** Only an allow-list is passed:
   `PATH`, `HOME`, `TMPDIR` (a private scratch folder), the locale, `NO_TELEMETRY`, and the
   variables Windows needs to start a process. Not `childEnvironment()`. The worker gets the
   project path and the instance host name, never anything to sign in with.
4. **Instance requests are answered by the main process, which checks them again.**
   - The worker's `InstanceExchange` sends each request over IPC.
   - The main process checks the origin and the read allow-list (ADR-0032 item 3) itself before
     sending: the worker's own check can't be relied on.
   - Requests go through the instance's scheduler and budget as today (ADR-0016).
   - Cancelling the use case kills the worker.
5. **The worker's answer is data.** The main process validates it against a schema, and refuses
   any file path in it that is outside the project.
6. **Where the operating system allows it, the worker is also sandboxed.**
   - **macOS:** `sandbox-exec`, with no network and no writes outside the build's scratch folder.
   - **Linux:** the same through `bwrap` or `unshare`, where the system allows unprivileged
     namespaces. To be verified when this is built.
   - **Windows:** no sandbox, the worker only.

   If the sandbox is missing or refuses to start, the worker runs without it and the output says
   so once. `snagentic doctor` reports which level this machine gets.
7. **A guard test pins the SDK's code-loading routes.** It lists the computed `import()` and
   `require()` calls in the SDK's build and transform paths. An SDK upgrade that changes the list
   fails until someone reviews it, alongside the connector contract test (ADR-0032 item 5).

## Consequences

- Code that runs in the worker, through a route nobody found, holds no credential or token
  everywhere.
- On a sandboxed macOS or Linux it also has no network and can't write outside the build copy.
- It can still read what the user can read. Unsandboxed (Windows, restricted Linux, CI
  containers) it can send that anywhere. The promise is "no credential" everywhere, and "no
  network" only where the sandbox ran.
- Each build costs one more process start, about 10–40 ms (spike).
- Apple marks `sandbox-exec` deprecated. If it goes away, macOS drops to the plain worker.
- Tests:
  - a worker contract test runs build and transform through the worker;
  - the sandbox tests run only where the sandbox exists (the macOS CI runner, and Linux if
    verified);
  - the in-process path is removed, not kept beside it.
- ADR-0032 is amended. Its other items stay: one connector,
  one scheduler, read routes only.

## Alternatives considered

- **Keep the SDK in-process, with #145's refusals and the guard test.** Cheapest, but it only
  catches routes someone found or a review spots. A missed route runs beside the credential.
- **Run `now-sdk` as a child process.** Rejected by ADR-0032: it needs the credential and
  bypasses the scheduler.
- **One long-lived worker.** Saves the start-up, which the spike showed is small. It would keep
  state across projects, which a worker per build doesn't.
- **A container (Docker or Podman).** Strong isolation, but most users don't run one, and it
  can't be required.
- **Node's `vm` module or ShadowRealm.** Not a security boundary, and the SDK needs Node's file
  system and module loading.
