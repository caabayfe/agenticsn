# 0056. Onboard an instance with one command, built into the binary

- Status: Accepted (product owner, 2026-11-14)
- Date: 2026-11-14
- Requirements: G1 (develop), ASR-06 (credentials), ASR-16 (instance load)
- Amends: 0010 (adds onboarding to scope)
- Relates to: 0003 (use case registry), 0011 (enforcement layers), 0012 (production read-only),
  0020 (instance trust), 0054 (each developer signs in as themselves)
- Evidence: read on `main` 90149dc7:
  - onboarding is nine manual commands (`init`, `instance add`, `auth login`, `doctor`, `pull`,
    `integrate`, `status`, then `agent install`);
  - a shell script, `onboard-pdi.sh`, does them for the ITSM accelerator team. It lives outside
    this repository, needs bash, curl and python3, and cannot run on Windows;
  - nothing in the code recognises a Brazil-release instance refusing REST Basic authentication
    (`snc_basic_auth_api_access`) or a hibernating PDI: both surface as a generic connection
    failure from `doctor`.

## Context

A new user has to learn the order of the commands, notice that a sleeping PDI answers nothing
useful, and know that Brazil-release instances answer 401 until the user holds a role. The
accelerator team solved this with a script that is not part of the product, depends on tools a
Windows machine lacks, and holds logic (checks, retries, messages) that no test covers.

AGENTS.md forbids that shape: every operation is a use case in the registry, and the CLI is
generated from it. A script embedded in the binary would put logic outside the registry and
outside the default test suite.

## Decision

1. **One use case, `onboard`**, in the registry. It runs, in order, and skips what is already done:
   1. create the workspace (`init`) when the folder isn't one;
   2. add the instance profile (`instance add`), refusing a profile that names another URL;
   3. sign in (`auth login`), storing the secret in the OS keychain as today (ADR-0020, ADR-0054);
   4. **name how the instance answered**: the sign-in's own first read (or, when a credential is
      already stored, one read of the signed-in user) is classified from the typed errors the
      connection already raises, as `ready`, `asleep` (the hibernation page), `unauthorized`
      (the instance refused the user), `unreachable` (no answer, or a timeout) or `refused`
      (another refusal, with its own message and hint). It adds no request of its own.
      `unauthorized` says what to check: the password, and on a Brazil-release instance the role
      `snc_basic_auth_api_access`; `asleep` says to wake the PDI and run the command again. The
      secret is kept only once the instance has accepted it;
   5. `doctor --instance`, stopping before the pull when a check fails;
   6. `pull`, then `integrate`;
   7. print `status` and the next steps (`agent install`, the guides).
2. **Resumable.** Run it again with the same answers to continue; each step reads current state,
   as `pull` already does. It adds no state of its own.
3. **For people, not agents.** It reads a secret, so, like `auth login`, it is not an MCP tool
   (the 13-tool budget is unchanged) and `--format agent` and hooks cannot run it for an agent.
4. **Same safety as every command.** It reads the instance; it writes only the workspace and the
   keychain. For `test` and `production` it needs `--acknowledge-read-only` and a credential that
   holds `snc_read_only`, as `instance add` does (ADR-0012). It never writes to an instance.
5. **The accelerator steps stay outside.** Pinning a pack in a worktree, the pack's regression
   property, retiring a replaced profile and `accelerator install` depend on a team's folder layout
   and on a pack repository, so they stay in the accelerator team's script (and its PowerShell
   port), which then calls `snagentic onboard` for steps 1 to 7.
6. **One implementation on every platform.** No bash, curl or python3, and no PowerShell port to
   keep in step.

## Consequences

- New users run one command, and the two commonest failures (a sleeping PDI, a missing Basic
  authentication role) say what to do.
- The check-and-classify logic has tests: a table of responses to outcomes, the use case against
  the in-memory fakes, and golden files for the messages. No default test touches a network.
- The accelerator script shrinks to its own concerns, and its Windows port needs only those.
- `docs/guides/onboarding.md` and the getting-started page describe one command, with the manual
  steps kept as the explanation of what it does.
- A new place where `doctor`'s checks and the awake check could drift: the awake check reuses the
  connection `doctor` opens rather than adding a second client.

## Alternatives considered

- **Embed the two scripts and add `onboard export` to write them out.** Quick, but the logic lives
  in shell and PowerShell, which the default tests can't run; it needs bash, curl and python3 or a
  second port to maintain; and the scripts name sibling folders only the accelerator team has.
  Rejected.
- **A native command that also pins and installs an accelerator pack (`--accelerator <pack>`).**
  Useful, but it couples the product to one team's folder layout. It can be added later as a
  separate decision once the layout is settled. Deferred.
