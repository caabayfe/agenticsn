# 0058. In team mode, the gate accepts only waivers on the reviewed branch

- Status: Accepted (2026-11-21)
- Date: 2026-11-21
- Requirements: G3, ASR-03, ASR-10
- Amends: 0006 (which copy of `waivers.yaml` the gate reads)
- Relates to: 0011 (enforcement layers), 0022 (pull requests), 0052 (the shared mirror)
- Evidence: spec 016, step S1 (finding SEC3-01), owner decision D2. Read on `main` 33ab1d73:
  - the gate reads `waivers.yaml` as committed on the current branch
    (`packages/cli/src/adapters/delivery/git-delivery-workspace.ts`, `HEAD:waivers.yaml`);
  - a waiver's fields are checked for shape, scope and expiry, and the approver is text
    (`packages/core/src/delivery/domain/waivers.ts`);
  - a profile with a shared mirror names the team's git remote
    (`packages/core/src/instance/domain/profile.ts`, ADR-0052).

## Context

ADR-0006 says a waiver is a reviewed exception: one rule, one path glob, a reason, an approver
and an expiry. The review is the control, and it happens in the pull request that changes
`waivers.yaml`.

The gate, however, read the file from the branch being pushed. A waiver took effect when it was
committed, before any pull request. In a team, the review that ADR-0006 relies on therefore came
after the push to the development instance it was meant to precede. The agent hooks refuse an
edit to the file on the hosts that run them, but hooks are guidance, not a boundary (ADR-0011).

A team already has a place where every change has been reviewed: the default branch of its git
remote. The profile already names that remote (ADR-0052).

## Decision

1. **Team mode: only waivers on the reviewed branch apply.** When the instance profile names a
   shared mirror, the gate reads `waivers.yaml` from the default branch of that remote
   (`<remote>/<default branch>`, for example `origin/main`), not from the branch being pushed.
   The same checks as before apply to each entry (scope, expiry, shape).

2. **The gate does not fetch.** It reads the remote-tracking ref this clone already has. The
   default branch is the one the clone recorded as `<remote>/HEAD`. A plan stays a local
   operation that sends nothing to the git server.

3. **What does not apply is reported, with what to do:**
   - a waiver committed on the branch that is not on the reviewed branch with the same rule,
     path, reason, approver and expiry: "open a pull request for it, and run `git fetch <remote>`
     once it is merged";
   - uncommitted changes to `waivers.yaml`: "only waivers on `<remote>/<branch>` apply";
   - a clone with no record of the remote's default branch: no waiver applies, and the message
     names `git remote set-head <remote> --auto`.

   These are waiver problems in the plan, not errors: a plan with no blocking finding stays
   ready.

4. **Solo mode keeps ADR-0006's rule.** Without a shared mirror there is no reviewed branch to
   read: the gate accepts the waivers committed on the current branch, and reports uncommitted
   changes. The plan lists every waived finding with its approver and reason, so the person who
   confirms the push sees each exception.

5. **No new setting.** Team mode is the profile's `shared_mirror`, as in ADR-0052.

## Consequences

- In a team, a waiver takes effect only after its pull request is merged and the clone has
  fetched. A developer who needs one opens the pull request first.
- A waiver merged to the default branch applies to every branch at once, including branches
  created before it. A waiver removed there stops applying at the next fetch, whatever a branch
  still holds.
- A clone made with `git clone` knows the remote's default branch. One made with `git init` and
  `git remote add`, or the clone that created the repository, runs
  `git remote set-head <remote> --auto` once.
- The control is as strong as the review of the default branch: branch protection with required
  review is part of team mode (ADR-0052, the team-mode guide).
- Limits, stated in `docs/product/security-and-governance.md`: the gate trusts the local
  clone's refs and the committed profile, which are files on the developer's machine. Branch
  protection and the pull request's review are the layers that do not depend on it (ADR-0011).
- The approver stays text. Who approved is the pull request's reviewer, recorded by the git
  platform.

## Alternatives considered

- **Keep reading the branch, and rely on the pull request.** Rejected by the owner (D2): the
  push happens before the review.
- **Accept a waiver only when it is on both the branch and the reviewed branch.** A branch
  created before a waiver was merged would have to merge the default branch before it could
  push. The reviewed branch alone is the reviewed state.
- **Fetch inside the gate.** It makes every plan depend on the network and on git credentials,
  and a plan is specified as local. The message names the fetch instead.
- **Ask the git platform which pull request added the waiver.** It needs the platform's CLI and
  a sign-in for every plan, and works on one platform at a time.
- **A new setting naming the reviewed branch.** The remote's default branch is what a team
  already protects; a setting in a workspace file would be one more thing to review.
- **Apply the rule in solo mode too.** A solo developer may have no remote at all, and has no
  second person to review. The plan shows each waived finding instead.
