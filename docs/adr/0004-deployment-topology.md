# 0004. One binary, git as the distribution layer, three operating modes

- Status: Accepted (amended by 0011, 0012, 0022)
- Date: 2026-10-05
- Requirements: ASR-02, ASR-03, ASR-05, ASR-06, ASR-07, ASR-08

## Context

The product must work for a single developer on a personal instance and for enterprise
teams of hundreds. Things that grow independently:

- developers and agents;
- instance size;
- number of instances;
- number of agent hosts.

Developers each pulling from ServiceNow would multiply API load and spread credentials.
Agents work best on local files.

## Decision

1. **One executable** (`snagentic`) holds every capability: sync, check, knowledge, MCP
   server, hook handler and agent-pack installer.
2. **It runs in two places:**
   - **Developer machines:** agents use files, the CLI and stdio MCP.
   - **CI runners** (container image of the same binary): scheduled pull, pull request
     gate, update-set validation before promotion, and push in governed mode.

   A read-only remote MCP over HTTP is a later deployment of the same code (open
   question).
3. **Git is the distribution layer.** Pull writes the remote state to the
   `servicenow-remote/<instance>` branch. Developers get it with `git pull`. Derived data
   is a pure function of a commit, so it can be cached by commit SHA.
4. **Three operating modes**, chosen by configuration:

   | Mode | Pull | Push to dev | Credentials | Enforcement |
   |---|---|---|---|---|
   | **Solo** (personal instance) | Local | Local | Developer's own, OS keychain | Gate in `push` |
   | **Team** (shared dev) | CI on a schedule | Local, with the developer's own user (real authorship in update sets) | Developer's own | Gate in `push` + PR gate + promotion validation |
   | **Governed** (enterprise) | CI | CI on merge, service account; agents have no write credentials | CI secrets | PR review and branch protection + gate + promotion validation |

5. **Promotion out of development is the control point.** People can always change dev
   in the browser, so the enforcement that matters is `validate --update-set <id>` in CI
   before an update set moves to test. It runs no matter who built the update set or how.
6. **Credentials come from the environment where the binary runs:** the OS keychain
   locally, secrets in CI. Never from the repository.

## Consequences

- No custom server to run for v1. The git platform provides review, approval and audit.
- Pull must be idempotent, incremental and able to run unattended.
- Write authority is a configured mode checked on every push, not a separate code path.
- CI templates (GitHub Actions, GitLab, Azure DevOps) are part of the product.

## Alternatives considered

- **A central server as the main interface.** Rejected for v1. It reimplements git for
  file distribution, adds identity and operations work, and agents still need local files.
- **Every developer pulls directly.** Allowed in solo mode only. It doesn't scale for
  teams (ASR-06).
- **A custom approval and jobs service, as in v1.** Rejected. Pull request review and
  branch protection already provide this.
