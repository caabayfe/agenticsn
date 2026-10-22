# Security policy

snagentic holds ServiceNow credentials and writes to development instances, so please report
anything that could weaken that, privately.

## Reporting a vulnerability

Use GitHub's private reporting: the **Security** tab of this repository, then **Report a
vulnerability**. Please don't open a public issue, pull request or discussion for a suspected
vulnerability.

Include the snagentic version (`snagentic --version`), the platform, and the steps or input that
show the problem. You will get an answer within 7 days.

## Supported versions

Only the latest release gets security fixes. `snagentic upgrade` installs it.

## What counts

Anything that breaks the safety invariants in `AGENTS.md` is in scope, for example:

- a write, or a "read" that writes, reaching a `test` or `production` instance;
- credentials reaching a file, a log, an error message, a child process that doesn't need them,
  or a commit;
- password fields, secret-like properties or business records written to disk unredacted;
- a push that skips the plan id, the gate or the remote base-hash check;
- tampering with a release binary or an upgrade going undetected.

Known advisories in third-party dependencies, and why each is accepted or fixed, are tracked in
`specs/012-security-hardening/plan.md` until the advisory register (step 2) exists.
