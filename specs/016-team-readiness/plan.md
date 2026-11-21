# 016. Team readiness: plan

- Status: Proposed (2026-11-21). Waits for the owner's decisions in §3
- Date: 2026-11-21
- Source: product audit of `main` 8ee71cef (release 2.22.3), 2026-11-21. It used three
  independent reviews (reliability, security, code quality and scope), a hands-on pass of the
  CLI, and the repository's gates (`bun run verify`: 3,008 pass, 12 skipped, 99.7 % line
  coverage). It made no live-instance calls. The findings stay local until their fixes ship, as
  for the earlier reviews; this plan names the security findings by ID only.
- Serves: G1-G3; ASR-06 (team scale), ASR-08 (data protection); the safety invariants in
  `AGENTS.md`
- Builds on: `specs/014-enterprise-readiness/plan.md`. Its stage 2 (licence, signing, release
  channel, second maintainer) stays there and is not repeated here.

## 1. Goal

Share snagentic with the team, as a pilot, without a known way to lose a mirror, a delivery or a
guarantee the documentation states. Each step is one small pull request that passes
`bun run verify`. Steps that change a decision get an ADR first.

**Ready to share when** (stage 0):
- no open finding can destroy or silently stale a mirror, or leave a delivery with no way out;
- every sentence in `docs/product/security-and-governance.md` is true of the code;
- the live tests ran green against a PDI in the last 24 hours, on a schedule;
- the agent evaluation was run on the 2.x Fluent flow and its report is published;
- one tagged release is named as the pilot release, with a pilot guide and its known limits.

**Pilot done when** (stages 1 and 2): a re-audit scores every dimension at least 8/10, and three
developers other than the owner have each delivered a change with it.

## 2. Where we start

| Dimension | Score | Main reasons |
|---|---|---|
| Code quality | 8/10 | No `any`, `!` or `@ts-ignore`; pure domain; behaviour-named tests with fakes |
| Security | 7/10 | Production write protection holds at four points; the agent-side gate on development is weaker than documented |
| Reliability | 6/10 | Push fails closed; one mirror-wiping pull bug; flow verification grows case by case |
| Ease of use | 6/10 | Polished CLI; many concepts to learn before a first delivery |
| Maintainability by others | 5/10 | 625 files, 18 contexts, 57 ADRs, a patched vendor SDK, stale contributor documents |
| Production readiness | 4-5/10 | The blockers below; no user other than the owner |

**By area:** understand and audit (`find`, `describe`, `advise`, `query`) is close to ready.
Delivery of records is beta. Delivery of flows is alpha: 17 delivery commits since 2.20 add
verification per trigger type. Accelerators and verified documentation are about 30 % of the
product code and most of its churn.

## 3. Decisions for the owner

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | What the pilot covers | 3 to 5 developers; understand and audit, and delivery of records. Flows, accelerators and verified documentation are labelled *preview* in help and guides | P1, P2 |
| D2 | Which waivers the gate accepts | In team mode, only waivers present on the reviewed branch (`origin/<default branch>`), so a waiver always passed a pull request. Solo mode keeps today's rule and the plan shows every waived finding. New ADR amending ADR-0006 | S1 |
| D3 | The way out of a delivery that cannot be recovered | Build `push --abandon-pending`: it asks for confirmation, lists what stays on the instance and in which update set, and records it in the ledger commit. Amends ADR-0050 | R3 |
| D4 | Live queries on test and production | Off unless the committed `instance.yaml` turns them on, with a local query log. Development keeps today's behaviour | S4 |
| D5 | A scheduled live run | A dedicated PDI and its credential as GitHub Actions secrets of a protected environment; nightly, reads plus one round trip. Until then, the same run from the owner's machine | T1 |
| D6 | Releases during the pilot | One release a week, fixes only. A hotfix only for data loss or security. No new commands until stage 1 is done | P1 |
| D7 | `pull` and `integrate` as one step | Add `snagentic sync [instance]` (pull, then integrate) as the everyday command; `pull` and `integrate` move to the advanced list. Decide after the pilot's first week, on what the developers trip over. Needs an ADR | U1 |
| D8 | The legacy 13-tool MCP interface | Remove it in the next minor; `agent install` already migrates an unchanged binding. Amends ADR-0057 | U2 |
| D9 | Accelerators and verified documentation | Keep them in the binary, move each to its own package with its own changelog, and take them out of the pilot's story. Not a separate product yet. Needs an ADR | M1 |
| D10 | Terms for the pilot | A one-paragraph evaluation notice for named colleagues until ADR-0008 is decided | P2 |

## 4. Steps

IDs: R reliability, S security, T tests and evidence, P pilot package, U usability,
M maintainability. Security findings are named by ID; the key is in the owner's local audit
notes.

### Stage 0. Before sharing (no feature work)

**Reliability**

| Step | Change | Test first |
|---|---|---|
| R1 | A full pull interrupted after the branch moved must never resume from an empty tree. Clear the checkpoint as soon as the mirror commit is durable, run the repack after it and treat its failure as a warning. A resume that finds a checkpoint and no progress ref continues from the branch tip | `it("keeps the mirror when a full pull stops during compaction")`, end to end with a real checkpoint |
| R2 | An incremental pull reports the records the change feed named and it could not store, with the next action (`pull --verify`), and counts them in `status` | `it("reports records it could not store")` |
| R3 | The exit of D3. Until it is built, the hints stop naming a command that does not exist | `it("abandons a pending delivery only after confirmation, and records what stays")` |
| R4 | `RecordChangedOnInstanceError` names the real remedy (`adopt --refresh`) and counts records, not journal steps. A flow or action that fails verification lists the fields that differ | Golden files of the three messages |
| R5 | `integrate` interrupted in a merge gives a hint that aborts the merge | `it("tells the user how to abort an interrupted merge")` |
| R6 | Merge the fixes in flight: #289 (commit hook environment), #290 (`adopt --refresh` ledger), #291 (future-dated fingerprint) | Their own |

**Security**

| Step | Change |
|---|---|
| S1 | SEC3-01 (waivers), as decided in D2. The same day, correct the sentence in `security-and-governance.md` that the code does not deliver |
| S2 | SEC3-02 (confirmation). The host rules match the program that runs, not a command prefix. The documentation says per host what asks the user and what is guidance only; hosts with no ask rule are named as such |
| S3 | SEC3-03 (live query predicates). A field that is masked in output is refused in a filter, a sort and a group |
| S4 | SEC3-04 (live query scope), as decided in D4, and a section on live queries in `security-and-governance.md` |
| S5 | SEC3-05 (runtime environment). The binary refuses to start in the runtime's passthrough mode |
| S6 | SEC3-07 (advisory gate). The gate fails on an audit that returns nothing or exits non-zero, and runs in `release.yml` |
| S7 | SEC3-08 (read-only check). `doctor` and `onboard` verify the credential before any call to a test or production instance |
| S8 | SEC3-11 (export). `update-sets export` uses the same secret scan as pull (ADR-0035) |

**Tests and evidence**

| Step | Change |
|---|---|
| T1 | A scheduled workflow runs `tests/live` against the PDI of D5 and opens an issue when it fails. `doctor --instance` prints the date of the last green run of the release |
| T2 | Agent evaluation for 2.x: scenarios for adopt, a Fluent edit, validate, plan and a refused push; two repetitions, variants A and A-cli. Publish the report. Until then the overview stops quoting the 1.0 result as current |
| T3 | Record the shapes of the instance's answers during the live run (fields and types, no values) and check the adapters' fakes against them in the default tests |

**Documents that must be true**

| Step | Change |
|---|---|
| P0 | `AGENTS.md` layout and test table match the repository (adapters in `packages/cli`, 18 contexts, rules by category, no `msw`). The README status line comes from `version.ts`, checked by the existing stale-docs test. "41 rules" is broken down by kind |

**Pilot package**

| Step | Change |
|---|---|
| P1 | Name the pilot release and the cadence of D6. `--help` and the guides mark flows, accelerators and verified documentation as *preview* (D1) |
| P2 | `docs/guides/pilot.md`: what to try in the first hour (onboard, three questions to the agent, one change delivered), known limits, how to report a problem, the notice of D10 |

### Stage 1. During the pilot

**Usability**

| Step | Change |
|---|---|
| U1 | `sync`, if D7 says so |
| U2 | Remove the legacy MCP interface (D8) |
| U3 | In a terminal, `push` without `--plan` shows the plan and asks. Agents and CI keep the two steps and the plan id. Amends ADR-0033 if accepted |
| U4 | The `find` hint in text output shows a command, not tool input |
| U5 | One page, `docs/guides/concepts.md`: mirror, adopt, ledger, keys, plan, batch, drift, journal, waiver, each in two sentences with the command that shows it |

**Reliability**

| Step | Change |
|---|---|
| R7 | Push reads each unit's version again immediately before its load, and stamps with the instance's clock. The remaining window is documented |
| R8 | Flows: a spike on one comparison rule for compiled units, to replace the per-trigger modules. Until it lands, no new per-trigger module is merged without a recorded reason |
| R9 | The delivery lock also covers git worktrees of one workspace. Two machines pushing as one user stays a documented limit |

**Security**

| Step | Change |
|---|---|
| S9 | SEC3-06 (installer). Provenance is checked without `gh` where the platform allows it; the installer says plainly when it could not |
| S10 | SEC3-10 (worker sandbox on Linux), the open follow-up of ADR-0044 |

**Maintainability**

| Step | Change |
|---|---|
| M1 | Accelerators and verified documentation move to their own packages (D9). The registry loads them as additional workflows |
| M2 | The 85 known boundary violations become a ratchet: the count may only fall. Burn down delivery (28) first |
| M3 | The 41 bare `Error`s become `SnagenticError` subclasses; a lint rule keeps it so |
| M4 | Policy leaves the registry: the collision rule in `install-steps.ts` and the profile and sign-in rules in `onboard-steps.ts` move to application services |
| M5 | Rules: a false-positive corpus from the out-of-box scripts for SN-MNT-001, SN-MNT-008 and SN-PERF-002, with a measured rate per rule in the rule's metadata |

### Stage 2. Before a wider rollout

- Stage 2 of spec 014: licence, signed binaries, release channel, a second maintainer.
- Feedback from the pilot turned into issues, each closed or declined with a reason.
- A re-audit by reviewers who did not write the fixes; every dimension at least 8/10.

## 5. Order

1. Day 1: P0 and the documentation half of S1 and S2 (they make the documents true at once),
   R1, R6.
2. Then, in parallel: R2, R4, R5, S3, S5, S6, S7, S8; T1 once D5 is decided; T2.
3. After D2, D3, D4: S1, R3, S4.
4. T3, P1, P2, then tag the pilot release.
5. Stage 1 starts when the pilot does. U1 waits for the first week's feedback.

Stage 0 is 20 small pull requests. Nothing in it needs a new command except R3.

## 6. Not in this plan

- New features, rules or artifact types.
- Writing to test or production (ADR-0038, section 5).
- Separating accelerators into their own product or repository.
