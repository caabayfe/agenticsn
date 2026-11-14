# 015. `snagentic onboard`: plan

- Status: Built (2026-11-14, unreleased). Builds ADR-0056 (accepted).
- Decision: ADR-0056

## 1. Goal

One command takes a new user from an empty folder to a pulled, integrated workspace, on macOS,
Linux and Windows, and names the fix for a sleeping PDI or a refused Basic authentication.

## 2. Steps (test first, each one commit)

| # | Test (behaviour) | Build |
|---|---|---|
| O1, O2 | `answerOf` names how an attempt ended from the connection's typed errors | `core/connection/domain/instance-answer.ts`; no new request, no new HTTP client |
| O3 | the steps run in order, a stop leaves later steps undone, a done step is reported `already` | `core/instance/application/onboard.ts` over an `OnboardSteps` port |
| O4 | `it("refuses a profile that names another instance")`, `it("needs --acknowledge-read-only for production")` | guards in `onboard` |
| O5 | the use case, `flags` set (`readOnly: false` for the workspace, `requiresDevelopmentInstance: false`), no `mcp`; `it("is not offered to agents")` | `registry/onboard.ts`, registered; `bun run docs` regenerates the reference |
| O6 | golden files for the `asleep` and `unauthorized` messages | `render` |
| O7 | docs: `onboarding.md` and getting started lead with `snagentic onboard`; changelog entry | |

## 3. Open

- The accelerator script's call to `snagentic onboard` waits for the release that ships it.
- A Windows run by a developer (the same open item as the rest of the Windows preview).
