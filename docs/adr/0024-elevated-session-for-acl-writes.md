# 0024. ACLs are written through an elevated browser session

- Status: Accepted
- Date: 2026-10-12
- Requirements: ASR-01, ASR-02, ASR-03, ASR-05, ASR-08, ASR-16
- Amends: 0010 (v1 scope)
- Relates to: 0011 (enforcement layers), 0016 (instance load), 0020 (instance trust),
  0021 (OAuth client credentials)

## Context

Most features need access controls. Writing `sys_security_acl` and `sys_security_acl_role`
needs the `security_admin` role, and that role is *elevated*: a person turns it on for one
interactive session. A Table API session cannot elevate, so `push` refuses ACLs and asks the
developer to create them by hand in the branch's update set (finding F12). A product that
leaves every ACL to the developer is not viable.

Spikes S9 and S9c (`tools/spikes/s9-acl-delivery/`) tried each route on two PDIs:

| Route | Result |
|---|---|
| Table API, Basic or OAuth | 403 "ACL Exception Insert Failed due to security constraints" |
| Remote update set loaded through the Table API | The ACL update record is refused |
| Interactive session, before elevation | 403, same as the Table API |
| Interactive session, after elevation, Table API calls from the page | 201 for ACLs and ACL roles; deletes 204 |
| Interactive session, after elevation, Import XML (`/sys_upload.do`) | Record created |

The elevated session behaved the same with a visible window and headless (run 3 on
2026-10-12). Sign-in took 19 s with a window and 38 s headless; each write after that took about
one second.

In the interactive session, both the REST inserts and the XML import are recorded in the user's
current update set. The session reads that update set **at sign-in**: a preference changed
after sign-in is ignored, and the records go to "Default".

On this release (Australia), elevation is the UI page `elevated_role_dialog`. Its processing
script calls `GlideSecurityManager.enableElevatedRole` and records the event
`security.elevated_role.enabled`. One form post to `/ui_page_process.do` from the signed-in page
turns it on; no dialog has to be clicked.

ADR-0010 lists "Playwright UI recipes" as out of scope. This ADR allows a narrow exception.

## Decision

1. **An elevated session exists only to write records that need an elevated role.** A table
   registry names those tables (`sys_security_acl`, `sys_security_acl_role`). When a push
   plan contains them, `push` writes them through an elevated session after its normal writes.
   Every other record keeps going through the normal connection. The gate, the plan id and
   the base hash check apply unchanged.
2. **The update set is chosen before signing in.** `push` sets the `sys_update_set` preference
   through the normal connection, as it does today, then opens the session.
3. **Signing in.** snagentic drives the installed Chrome or Edge through `playwright-core`, in
   a throwaway context: no profile on disk, no traces, no screenshots.
   - Basic profiles: snagentic fills the login form with the keychain password, headless.
     The person sees nothing.
   - SSO, MFA and OAuth profiles: a visible window opens on the login page and the person signs
     in. snagentic waits, honoring the use case's cancellation and a timeout. This path needs
     its own spike before it ships (see Consequences).
   - The session user must match the profile's user (ADR-0021 identity check). If they differ,
     the write is refused (`identity-mismatch`).
4. **Elevation is one request.** snagentic posts `elevated_role_dialog` with `security_admin`
   only, never other elevated roles. A 403 after elevation is reported as
   `elevation-failed`, with a hint to make the change by hand.
5. **Requests go through the scheduler.** The session is a `Transport` that sends each request
   from inside the page, carrying the page's token. The request scheduler wraps it like any
   other transport (ADR-0016): concurrency, rate limit, budget, cancellation. The session
   adds one sign-in and one elevation request per push.
6. **Nothing outlives the push.** After the writes, snagentic signs out and closes the browser,
   which ends the server session and the elevation. Cookies and tokens stay in memory and never
   appear in logs, errors or files.
7. **Elevation is opted into outside the repository.** `snagentic auth login --allow-elevation`
   records the opt-in in the instance's keychain item, next to `url` and `kind` (ADR-0020).
   An agent cannot turn it on by editing `instance.yaml`. Without the opt-in, `push` refuses
   ACLs with today's message, plus a hint to opt in.
8. **Development instances only.** The session factory refuses any profile that is not of kind
   `development`, on top of write use cases being absent for test and production (ADR-0012).
9. **Scope of the exception.** The UI is touched for exactly two things: the login form and
   the elevation post. Everything else stays on documented APIs. Other UI automation remains
   out of scope (ADR-0010).

## Consequences

- ACLs go from the branch to the development update set like any other record, with no manual
  step for password profiles. They travel to test with the update set.
- **New optional prerequisite.** ACL delivery needs Chrome or Edge installed. Everything else
  still needs only `git` (ASR-05). Without a browser, `push` refuses ACLs and says why. CI
  containers that push in governed mode need a browser image.
- **New dependency:** `playwright-core`, JavaScript only, no browser download. It must work
  inside the compiled binary. If it does not, snagentic drives Chrome directly through the
  DevTools protocol, behind the same `Transport`.
- **Undocumented endpoints.** The login form, the `g_ck` token and `elevated_role_dialog` are not
  public APIs. A live contract test (`tests/live`) covers them on each new release. When one
  breaks, `push` fails with `elevation-failed` and the manual hint; it never writes
  half-elevated.
- **Guardrails must cover ACLs before this ships.** Today rules-basic has one ACL rule (a script
  that always returns true). Add metadata rules at least for: a write, create or delete ACL with
  no role, condition or script; a deny ACL that is deactivated or deleted; and `admin_overrides`
  turned off. The push summary lists every ACL written through elevation.
- **Audit trail.** Each elevation records `security.elevated_role.enabled` on the instance, so
  instance audit can see every elevated push.
- **Prompt injection.** An agent could push a permissive ACL to a development instance. It
  passes the same gate as everything else, an agent can already write server scripts that run
  as system, and promotion validation (ADR-0011, layer 7) checks the update set before test.
  Elevation adds no new reach outside development.
- **Open before the interactive path ships:** the person who signs in may not be the profile's
  user, and the update set must be chosen before sign-in. A spike must show either switching the
  current update set inside the session, or a second, silent sign-in after setting the
  preference.
- The MCP budget is unchanged: no new tool. When a window opens, the `push` result tells the
  agent to ask the person to sign in.

## Alternatives considered

- **Import XML or an update set XML through `/sys_upload.do`.** It works and is recorded in the
  update set, but it needs the same elevated session, and its only answer is a redirect: each
  record's outcome has to be queried afterwards. Table API calls report success or failure per
  record, like the rest of `push`.
- **Remote update set committed through the CI/CD API.** Loading the ACL update record through
  the Table API is refused, and uploading the XML needs a browser session anyway.
- **Ask the person to elevate and create ACLs by hand** (current behavior). Not viable as the
  only path. It stays as the fallback when elevation is not opted into or fails.
- **A companion app on the instance that writes ACLs with server code.** It needs installing,
  `security_admin` to install, and a scripted entry point that writes security records. Larger
  surface for the same result.
- **Scoped app install (ServiceNow SDK, app repository).** Delivers ACLs without elevation, but
  only for scoped apps, and only through a different delivery model.
- **Sign in without a browser** (post the login form directly). It saves the browser
  prerequisite for password profiles, but it is a second code path, and SSO profiles still need
  the browser. Revisit if the browser prerequisite proves costly.
