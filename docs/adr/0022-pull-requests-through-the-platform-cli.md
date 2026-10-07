# 0022. Pull requests are linked and opened through the git platform's CLI

- Status: Accepted
- Date: 2026-10-07
- Requirements: ASR-05
- Amends: 0004 (deployment topology)
- Relates to: 0010 (v1 scope), 0011 (enforcement layers), spec 004 (D3)

## Context

Each branch is pushed into its own update set batch, and every pull request is its own
update set (spec 004, D3). The owner wants the pull request and its batch linked both ways,
by snagentic itself: logic in one place, the same in every agent host, CI and the terminal,
rather than in a skill that an agent may or may not follow (ADR-0011).

Agents usually push before a pull request exists, so a push also needs a way to open one.
ADR-0004 leaves review to the git platform and gave snagentic no access to it. Talking to
GitHub, GitLab or Azure DevOps directly would mean storing a token per platform.

Two constraints shape the decision:

- `git` is the only prerequisite (ASR-05); the platform's CLI cannot become another.
- Push writes the working tree, committed or not (spec 004, D1). A pull request holds commits,
  so one opened from uncommitted work would not show what was pushed.

## Decision

1. **The platform's own CLI, behind a port.** A `PullRequests` port finds a branch's open pull
   request and opens a draft one. The first adapter runs GitHub's `gh` in the workspace; other
   platforms (`glab`, `az repos`) are further adapters. snagentic never reads, stores or asks
   for a platform token: the CLI's sign-in (or `GH_TOKEN` in CI) is used as is.
2. **Every push links the branch's open pull request.** Push looks it up and adds its link to
   the batch's description. Looking up only reads. When the CLI is missing, not signed in, or
   the workspace has no remote on the platform, push goes on and reports that the batch has
   no pull request linked, and why. `--pr <url>` names the pull request instead of looking it
   up.
3. **`push --draft-pr` opens one when the branch has none,** before anything is written to the
   instance, so a failure leaves the instance untouched:
   - it refuses while any planned file has uncommitted changes ("commit, then push again"), so
     the pull request matches what is pushed;
   - it refuses on the repository's default branch;
   - it pushes the branch with `git push --set-upstream` to its remote (`origin` when it has
     none), then opens a draft pull request whose body names the batch and links it on the
     instance.

   Outward actions happen only with this flag; a push without it never runs `git push` or
   opens a pull request.
4. **Calls are bounded.** Each CLI call has a timeout and honours the use case's cancellation
   signal. Failures of the lookup are reported, never fatal; failures of `--draft-pr` stop the
   push before the first instance write.

## Consequences

- The batch and its pull request link each other with no skill involved, in every host and in
  CI (governed mode, ADR-0004), where `gh` and `GH_TOKEN` are usually present.
- Users without `gh` lose only the link; ASR-05 holds.
- Every push makes one or two local CLI calls (about a second on GitHub). Nothing changes on
  the instance side (ADR-0016).
- GitHub is the only platform at first. GitLab and Azure DevOps need their own adapter and
  contract tests, not changes to push.
- A pull request's link is guidance for reviewers, not a guarantee: the batch can still be
  promoted without its pull request being merged. Enforcing that is update-set validation
  before promotion (ADR-0010, phase 5).
