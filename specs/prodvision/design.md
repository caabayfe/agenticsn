# Product vision: from a developer tool to the agentic platform team

- Status: Draft, for the product owner's review
- Date: 2026-10-16
- Author: product review session (Claude), from a read of the repository at `8b3d361`
- Requirements: G1, G2, G3; touches ASR-03, ASR-06, ASR-08, ASR-09, ASR-12, ASR-15, ASR-16
- Decisions needed: section 10 lists every ADR this vision implies. **Nothing here is in scope
  until its ADR is accepted** (ADR-0010).

## 0. Summary

snagentic is strong on the **build loop** for one developer: mirror, find, describe, advise,
validate, plan and push to development, with safety enforced in code.

**The market moved in 2026, and the positioning has to move with it** (section 4). ServiceNow now
ships "build ServiceNow with your own coding agent" itself: its SDK and agent skill are free, Build
Agent runs inside Claude Code, Cursor and Copilot (licensed, with a trial and a planned freemium
tier), and Autonomous Engineer builds stories end to end. Quality
Clouds sells AI code governance with an MCP server. snagentic can't win on authoring. It can win
as **the independent, outside view of the instance**: the whole customized estate offline and in
git, guardrails the customer owns and runs in CI, and production access that can't write.
ServiceNow's tools run inside the instance and trust it; snagentic audits it. Spec 008 (Fluent)
is still right: it puts snagentic in the format ServiceNow's agents use, so it complements Build
Agent instead of fighting it.

Three things stand between snagentic and the product you described.

1. **It isn't ready to hand to a team yet, for reasons unrelated to features.** The workspace
   format is about to change (2.0, Fluent-only, no migration). There is no license grant, the
   binary isn't signed, there is no template for the central pull that team mode depends on, and
   nothing measures whether it saves time. Section 3 lists ten release blockers. Most are small.
2. **The agent can write, but it can't check its work.** Nothing lets it run what it built on the
   development instance: no ATF run, no reading logs after a test, no test authoring. Closing
   this loop is the biggest single speed-up for developers, and it is allowed on development
   instances (the production exclusions in ADR-0012 don't apply). Section 5.1.
3. **Audit and troubleshooting are on the roadmap but unbuilt.** Phases 4 to 6 of ADR-0010
   (reference graph, audit reports, update-set validation, read-only production investigation)
   have no code yet. The audit half can run **entirely on the mirror, with zero instance load**,
   which nobody else can offer. Sections 5.2 and 5.3.

The out-of-the-box bet (section 7) is **the Steward**: snagentic run headless on a schedule, as
an autonomous member of the platform team, "Dependabot for ServiceNow". Every night it pulls,
audits, and opens reviewed pull requests that pay down technical debt, prepare the next upgrade
and document the instance. It never pushes on its own. Autonomous agents for **stories** already
exist (Autonomous Engineer, Echelon, RapDev APO). Nobody does the work that is **owed rather than
asked for**, and the upgrade is the biggest owed job of all, twice a year, with no ServiceNow
agent that resolves skipped records. The Steward sells outcomes (debt down every month, upgrade
weeks saved) to the platform owner and to partners' managed services, not seats to developers.

Recommended order (section 9): **R0 pilot-ready** (blockers, read-side pilot now), **R1 close the
loop** (2.0 plus test and observe on development), **R2 audit** (health reports from the mirror,
update-set validation in CI), **R3 investigate** (read gateway, production troubleshooting),
**R4 Steward** (scheduled agent; upgrade preparation as its defining job). R2 is the strongest
commercial wedge and the least contested by ServiceNow; if the pilot's buyer is a platform owner
rather than a development lead, swap R1 and R2.

## 1. What snagentic is today

Version 1.8.0 (2026-10-15), with 2.0 (Fluent-only authoring, spec 008) planned and its decisions
accepted.

| Goal | Capability | Commands and MCP tools | Maturity |
|---|---|---|---|
| G1 Develop | Full and incremental mirror of every metadata class (2,224 classes, 463k records on a PDI), incremental pull at 22 requests | `pull`, `integrate`, `status` | Proven live |
| G1 Develop | Push a reviewed plan to a development update set, gated, collision-aware, capture verified; ACLs (elevated session), choices, layouts, scoped apps, domains, flows (Fluent) | `plan-push`, `push` | Proven live; moving to Fluent in 2.0 |
| G1 Develop | Accelerator packs: ready-made capabilities, plugin readiness, data templates | `accelerator *` | Mechanism shipped; no pack yet (ITSM is next) |
| G1 Develop | Plugins: inventory and activation on development | `plugins`, `plugin_activate` | Shipped |
| G2 Understand | Find by name or code; describe a table in execution order; who refers to a record | `find`, `describe` | Shipped; flows and global business rules missing from `describe` |
| G2 Understand | Update sets read live: list, show, collisions, export | `update_sets` | Shipped |
| G3 Guardrails | Advice least custom first; 33 rules (8 security, 7 performance, 12 manageability, 3 upgradability, 3 UX), new findings only; checks after each edit, at commit and in push | `advise`, `validate`, `check`, hooks | Shipped; local changes only |
| Agents | One MCP server (13 tools, at the ASR-09 cap), 5 skills, hooks for Claude Code and Copilot; eval harness (95% on the shipped instructions) | `mcp`, `agent install` | Shipped |
| Safety | Production read-only by construction (5 layers), credentials in the keychain bound to URL and kind, secrets redacted before disk | everywhere | Layers 3 and 4 shipped; gateway and S6 pending |

**Strengths to build on, because they are hard to copy:**

1. **The mirror in git.** Every metadata record of every scope, out-of-box included, as files with
   history. It is a queryable model of the instance that costs the instance nothing to consult,
   and the git history is a time series of the configuration that ServiceNow itself does not keep
   in a usable form.
2. **Execution-order knowledge.** `describe` answers "what runs when I save this?", the
   question every ServiceNow investigation starts with.
3. **Enforcement in code.** The gate, kinds and credential binding make it safe to let an agent
   act. This is what makes autonomy (section 7) sellable to a platform owner.
4. **Low instance load as a measured property** (ASR-16). Security and platform teams will
   accept a tool that proves it doesn't hurt production.
5. **Agent neutrality** (ASR-01). It rides on whichever agent the customer already pays for.
   ServiceNow's SDK skills now do the same, so this is table stakes, not a moat (section 4.1).

**Debts visible from the outside:**

- `docs/product/overview.md` still says 1.2.0, 12 tools and 24 rules; its roadmap is out of date.
- The README promises Cursor and Codex; `agent install` supports only Claude Code and Copilot.
- Open business decisions since 2026-10-05: license (ADR-0008 still proposed), code signing,
  distribution.

## 2. Method

- Read: README, product docs, all 33 ADR titles and the scope, production and commercial ADRs in
  full, the requirements, the changelog, specs 005 to 008, the use-case registry, the rule
  catalogue and the skills.
- Checked in code whether each roadmap item exists (impact analysis, audit, update-set validation,
  SARIF, CI templates, gateway, ATF, logs).
- Market evidence (section 4) from public sources, cited and dated in
  [`market-brief.md`](market-brief.md). Scores (section 5.5) are judgment, to be replaced by
  pilot measurements.

Each candidate capability is scored on six criteria, chosen because they decide whether it is
worth building:

| Criterion | Question | Weight |
|---|---|---|
| Hours | How many person-hours a year does it consume in a typical customer? | 3 |
| Agentic leverage | How much of the work can an agent do well with snagentic's assets? | 3 |
| Asset fit | Does it reuse the mirror, rules, gate and knowledge, or need a new engine? | 2 |
| Defensibility | Will ServiceNow or a competitor ship the same within a year? | 2 |
| Safety cost | How much new risk (production access, business data) does it bring? | 2 (inverted) |
| Time to value | How soon can a pilot use it? | 1 |

## 3. Releasing to a development team: readiness

The question is: can a team of ServiceNow developers adopt snagentic **next month** and get value?
The core flow can. These items stand in the way, ordered by impact.

| # | Blocker | Why it matters | Proposal | Size |
|---|---|---|---|---|
| B1 | **2.0 changes the workspace format with no migration** | A team that starts editing YAML records on 1.8 must re-create workspaces and relearn authoring at 2.0 | Pilot the **read side** now (find, describe, advise, validate, update sets); start authoring pilots on 2.0. Re-creating a workspace is one pull (about 30 min), so that's acceptable for read-only users | Decision |
| B2 | **No license grant** ("all rights reserved") | A company's legal team won't let developers install it | A pilot or evaluation license now, independent of the open-core decision (ADR-0008) | Decision |
| B3 | **Unsigned 215 MB binary** | Endpoint protection in enterprises blocks or quarantines it; Gatekeeper and SmartScreen warn | Apple Developer ID and a Windows signing certificate; notarize on release | Small, needs accounts |
| B4 | **No central pull template** | Team mode (ASR-06) assumes a scheduled pull, but there is no GitHub Actions, GitLab or Azure DevOps template, and no documentation of the service account | `ci/` templates for the scheduled pull and the pull-request gate; guide for the integration user | Medium |
| B5 | **SSO-only instances** | Many enterprise development instances disable basic auth for people; ACL pushes use an elevated browser session whose SSO behavior is unproven (memory: SSO spike pending) | Finish the SSO spike; document OAuth client credentials (ADR-0021) as the default for teams | Small to medium |
| B6 | **Data handling statement** | Security asks where instance metadata goes. The answer exists (to the agent's model provider, nowhere else) but not as a one-page answer for a procurement questionnaire | A data processing note and a "what leaves your network" diagram | Small |
| B7 | **Host coverage** | Cursor and Codex users get no skills or MCP config from `agent install` | Add hosts, or stop claiming them | Small per host |
| B8 | **No measurement** | Without numbers, the pilot can't prove "drastically accelerate", and we can't decide what to build next | Opt-in, local-first usage log (commands, durations, outcomes; no instance data) plus a pilot scorecard (section 8) | Medium; needs an ADR (privacy) |
| B9 | **Stale product docs** | First impression for the team lead | Refresh the overview, roadmap and tool counts at the 2.0 release | Small |
| B10 | **Support path** | Who answers when a pull fails on their instance? | Issue template, `doctor --report` bundle (redacted), a named contact for the pilot | Small |

None of these needs new product capability. B1, B2 and B8 are the ones that decide whether a
pilot produces a usable verdict.

## 4. The market in October 2026

Sources were read on 2026-10-16; the full list is in [`market-brief.md`](market-brief.md).
Items marked *weak* rest on a single low-quality source.

### 4.1 What ServiceNow now ships, and what that means

ServiceNow moved fast in 2026, and much of it lands on snagentic's original pitch.

| ServiceNow offering (2026) | What it does | Effect on snagentic |
|---|---|---|
| **Build Agent** in Claude Code, Cursor, Copilot and Windsurf through the SDK's skills (GA May 2026); Claude is its default model | Builds apps with an agent from the developer's own editor, "including out-of-the-box applications". Documented limit: apps under 20 tables; the SDK manipulates less metadata than Studio | **"Use your own agent" is no longer a differentiator.** Greenfield app generation is ServiceNow's ground |
| **Autonomous Engineer** (AI Workflow Factory SKU, Sept 2026) | Reads the instance, plans work items with acceptance criteria, builds them in parallel, generates ATF tests | Story-to-change (D6) is contested by ServiceNow itself |
| **SDK 4.x and Fluent**: about 64 metadata types, ATF tests (parameterized), `sys_domain`, `query` for live lookups | The authoring language for agents | **Validates spec 008**: snagentic authors in the format ServiceNow's agents use. It also commoditizes authoring |
| **Out-of-box MCP servers** for ITSM, ITOM, CMDB, SPM (Sept 2026); **Action Fabric** MCP (May 2026) | Let outside agents run governed operational actions | Operational, not metadata. Nothing gives an agent the whole customized estate, offline, with history |
| **Instance Scan** in the IDE; **Impact** HealthScan (about 10% to 30% of subscription); **Proactive Code Check** being deprecated | Scans and health scores, priced high, inside the instance | Gap for offline guardrails that live in git and run in CI |
| **Upgrade Preview** with AI summaries; ATF Test Generator and Cloud Runner in the Upgrade Console | Predicts skipped records; generates new tests (not updates to existing ones) | No agent that resolves skipped records. Likely ServiceNow's next move here |
| **Brazil** (GA expected November 2026): Developer Sandboxes, Flow Troubleshooting Agent | Pooled sandboxes with update sets set up; flow debugging | Sandboxes make D1 (test on development) easier to adopt: every developer has a disposable instance |

**Conclusion:** don't sell snagentic as "build ServiceNow with your agent". ServiceNow ships that
itself, and bundles it with the licenses customers already buy. Sell what ServiceNow structurally won't build: **an independent, offline, git-native view
of the whole customized estate, guardrails the customer owns, and production access that can't
write.** ServiceNow's tools run inside the instance and trust it. snagentic is the outside view
that audits it.

**Tested in spike S18** (`tools/spikes/s18-sdk-skill-only/README.md`, 2026-10-16). Claude Code
ran with only ServiceNow's SDK plugin on snagentic's evaluation prompts, against pdi2: 12 runs,
$4.15.

| Finding | Evidence | What it means for snagentic |
|---|---|---|
| New scoped apps work well | A table, business rule, ACLs and an ATF test, built and installed in 2.7 minutes for $0.60 | Don't compete there |
| Targeted questions are answered correctly and cheaply | Right answer on "why does state change on assignment", $0.09, 7 to 17 live queries | Speed of answers isn't the pitch |
| Answers vary, and inherited behavior gets missed | One of two runs missed a business rule inherited from `task` | `describe`'s complete, deterministic view is a differentiator |
| Designs miss what already exists | Neither run found the existing *Incident Priority Raised* notification or the on-call flow action | `advise`'s reuse-first evidence is a differentiator |
| **A change to a global table can't reach an update set** | The scoped build refuses it, and installing a global project fails. One run hid the policy in a new scoped app with no update-set entry; the other looked for the credential to use the Table API | **snagentic's delivery into update sets, through the SDK's own load route, is the strongest proven gap** |
| Review of obvious problems needs no rules | The plain model found every planted issue in 12 seconds | The rules' value is enforcement (the gate), not detection |

So the message for a development team is: *keep ServiceNow's plugin for new apps; use snagentic
to change the instance you already have, and to deliver it the way your promotion process
expects.*

### 4.2 Third parties

| Competitor | What it is | Overlap |
|---|---|---|
| **Quality Clouds** | "AI code governance for ServiceNow": 350 to about 1,000 rules, quality gates, scans of instances and git repositories, a hosted MCP server for Claude Code, Cursor and Copilot, an AI rule builder | **Direct** on G3 and audit. Hosted and proprietary; snagentic is local, has execution-order knowledge and a delivery path |
| **Echelon** (seed $4.75M, Oct 2025); **RapDev APO** (2026) | Autonomous agents working the ServiceNow backlog end to end, with human oversight; APO is a managed service | Direct on autonomous delivery of stories. Neither is described as a local, customer-owned tool with read-only production |
| Community MCP servers (echelon-ai-labs/servicenow-mcp, about 300 stars; jschuller, sukhmal, torkian, others) | Live Table API wrappers, often with writes, up to 180 tools | Indirect. No mirror, no gate, no plan; jschuller's shows read-only tools to read-only identities |
| AutomatePro; xtype; Perspectium; SN Utils | Test automation; multi-instance governance and instance sync; data sync; browser extension | Adjacent. AutomatePro on tests; xtype on drift and clone-downs |

### 4.3 Where the hours go

Public data is thin. It supports upgrades, clone-downs and technical debt; it is silent on
production troubleshooting and security reviews, which the pilot must measure (B8).

| Time sink | Evidence | snagentic's position |
|---|---|---|
| **Upgrades** | 1 to 2 months to take dev, QA and production through one (*weak*); 2 to 4 weeks to verify a major upgrade, about half manual testing; up to 4 months for a heavily customized instance (2021 case) | **Missing** (out of scope by ADR-0010) |
| **Clone-downs and environment drift** | 70% say clone-downs disrupt development; 43% clone quarterly (xtype survey, Q4 2024, vendor-biased) | Partial: the mirror sees drift, nothing reports it |
| **Technical debt** | Average configuration ratio 67% across 115 instances, lines of code rising every year (Quality Clouds, 2023) | **Missing**, but the mirror makes it cheap |
| **Governance and audit evidence** | 25% track audit logs in spreadsheets; 16% give admins full access in every environment (xtype) | Strong story for read-only by construction; no report yet |
| Understanding what already runs | No public data; every change starts with it | **Strong** (`describe`, `find`) |
| Testing | Half of upgrade verification is manual testing | **Missing** |
| Production troubleshooting, security reviews, performance tuning, documentation | No public data found | Missing; measure in the pilot before investing heavily |

### 4.4 Market size

- About 8,700 ServiceNow customers; 603 above $5M a year (10-K, 2025).
- 2,700 partners earn $6.02 per $1 of ServiceNow revenue; lifecycle services (after
  implementation) grow from about 37% to 50% of partner profit by 2029 (IDC, Sept 2026).
- About 25,000 certified developers (*weak*). UK median contract rate £550 a day; US contractors
  $85 to $171 an hour.

Partners are the most attractive first buyers: they pay for developer days directly, they live on
lifecycle services (health checks, upgrades, managed services), and they arrive at unfamiliar
instances where `describe` pays back on day one.

## 5. Missing capabilities, by goal

Each item names the asset it reuses, the safety question it raises and the ADR it needs.

### 5.1 Develop: close the loop

Today the agent writes a change, validates it statically and pushes it. Then it is blind: it
can't run the change, can't see what happened, and can't write a test that proves it. That is
where a human takes over, and where most of the remaining time goes.

| ID | Capability | What it does | Reuses | Safety | Needs |
|---|---|---|---|---|---|
| D1 | **Test on development** | Run ATF tests and suites on a development instance and return results, step by step, with the failing step's output | Push's connection, request scheduler, kinds | Development only; ATF execution is excluded on production by ADR-0012, allowed on development | ADR (new write-like use case), 1 MCP tool or folded into `push` |
| D2 | **Author tests** | Generate ATF tests (in Fluent, which supports ATF) from the change and from `describe`: one test per behavior the change adds, plus the existing behavior on that table it might break | Knowledge, Fluent build, the gate | None new | Skill + rule "a change without a test" (warn) |
| D3 | **Observe after the run** | After a test or a push, read the development instance's logs, the transaction's business rule trace and errors in the time window, so the agent can debug its own change | The same bounded log readers production troubleshooting needs (5.3), on development first | Development only at first; it is the first half of the production read gateway, built where mistakes are cheap | ADR, shared with 5.3 |
| D4 | **Impact analysis** | "What breaks if I change this field, script include or table?" Reference graph over the mirror: scripts that read the field, ACLs, UI policies, reports, flows, integrations | Mirror, index; planned in phase 4 | None | In scope (phase 4); extends `describe` |
| D5 | **Adopt a browser change** | A developer changed something in the browser on development; bring it into source as a pull request with validation | `adopt` of spec 008, update sets read live | None | In scope with 2.0 |
| D6 | **Story to change** | From a story (ServiceNow rm_story, Jira, GitHub issue), produce the design record, the change, its tests and the plan, as one pull request | advise design phase, skills, D2 | Reads a story: business data, prompt-injection surface | Skill first, no new tool |

D1 to D3 are the step from "the agent writes code" to "the agent delivers a working, tested
change". That is what "drastically accelerate" needs, and it stays within G1 and ADR-0012.

What the market changes here:

- **D2 rides on ServiceNow's work.** Fluent now authors ATF tests (parameterized), so snagentic
  generates tests in the same source as the change. The differentiator is what goes *into* the
  test: the existing behavior on that table, from `describe`, which a generator without the
  estate doesn't see. ServiceNow's own generator creates tests but can't update existing ones.
- **D6 is contested** by Autonomous Engineer and Echelon. Keep it a skill over D1 to D4; don't
  build a story pipeline.
- **Brazil's Developer Sandboxes** (pooled, refreshed daily) make D1 cheap to adopt: each
  developer, or the agent, gets a disposable development instance to test on.
- **Coexist with Build Agent.** A team may use Build Agent to scaffold and snagentic to
  understand, check and deliver. Both author Fluent after 2.0; the getting-started guide should
  show the two together.

### 5.2 Audit: the instance health report, from the mirror

Everything below reads **only the mirror**: no instance load, no production credential, no
business data. That makes it the safest and fastest new value.

| ID | Capability | What it reports | Notes |
|---|---|---|---|
| A1 | **Health report** | Scored report over the whole instance, in the five rule categories, with trends across git history: findings per scope, per class, per author, new versus fixed since last month | Runs the existing 33 rules over every record, not only the change. Calibration exists (17,026 out-of-box scripts in 92 s). Output as Markdown, JSON and SARIF |
| A2 | **Customization and upgrade exposure** | Out-of-box records the customer changed (each a future skipped record), customizations by scope and age, forecast of the next upgrade's review load | The mirror holds every out-of-box record with its customer changes; telling a customized one from a pristine one needs the instance's update versions (one bounded read, to confirm in a spike); ADR-0010 lists upgrade intelligence as out of scope, so the forecast part needs an ADR |
| A3 | **Dead and duplicate logic** | Inactive records nobody refers to, script includes nobody calls, business rules with the same condition on the same table, near-duplicate scripts | Needs the reference graph (D4) |
| A4 | **Security posture** | Tables without ACLs, ACLs granting to `public` or with unconditional scripts, scripted REST APIs without authentication, UI pages reachable publicly, risky system properties, elevated roles granted to groups | Metadata only. Role membership (`sys_user_has_role`) is business data: count it on the instance, don't mirror it |
| A5 | **Usability** | Forms with too many fields or sections, mandatory fields sprawl, UI policies fighting each other on one field, client scripts doing UI policy work, lists with too many columns | New rule category content; `describe` already orders the behavior |
| A6 | **Performance at rest** | Queries on unindexed fields (the mirror has the dictionary and indexes), scripts with queries in loops, before rules calling outbound APIs, scheduled jobs that overlap | Extends the performance rules to whole-instance scans |
| A7 | **Update-set validation before promotion** | Validate an update set built in the browser (ASR-12), in CI or by a release manager, with the same engine and finding format | Planned in phase 5; ADR-0006 already covers it |
| A8 | **Living documentation** | Generated, always current: per table or process, what it does in execution order, who changed it, which integrations touch it | `describe` plus git history; a skill and a report, not a tool |

A1, A4 and A7 together replace a large part of a paid "health check" engagement (section 4) and
can be run monthly instead of yearly.

**Against Quality Clouds and Impact.** Quality Clouds has more rules (up to about 1,000 against
33). Impact costs 10% to 30% of the subscription. snagentic should not race on rule count. It
competes on what they lack:

- **Offline.** It runs on the mirror, in the customer's network and CI. Nothing is hosted, and
  scanning costs the instance nothing.
- **Context.** Execution order and the reference graph explain *why* a finding matters ("this
  rule runs before the assignment rule on every save").
- **Trends from git.** Debt per month, per scope and per author, from history nobody else keeps.
- **A fix path.** A finding becomes a branch, a change, a test and a plan to development. Scanners
  report; snagentic, and later the Steward (section 7), fixes.
- **Timing.** Proactive Code Check, which scans update sets, is being deprecated. A7 in CI takes
  its place.

### 5.3 Troubleshoot production: read-only investigation

This is phase 6 of ADR-0010 and fully designed in ADR-0012. It is the most valuable capability
for the operations side and the most dangerous one. The order matters: build the readers on
development (D3), prove the guarantees (spike S6, the gateway), then point them at production.

| ID | Capability | What it does |
|---|---|---|
| T1 | **Read gateway** | The same MCP server, remote, holding the production credential; agents authenticate as themselves; every query audited; budgets and redaction enforced (ADR-0012 layer 2). Prerequisite for team use of T2 to T6 |
| T2 | **Explain a record's journey** | "Why is this incident in this state?" The mirrored execution order plus the record's audit history and journal (redacted), the flows and workflows that ran on it, and which rule set which field |
| T3 | **Slow transactions and errors** | Bounded reads of transaction logs, slow queries, and system log errors in a time window, joined with the mirror to name the script and line responsible |
| T4 | **Integration triage** | Outbound REST and SOAP logs, the ECC queue, import set runs, MID server status: what failed, since when, and which configuration changed around then |
| T5 | **Jobs and flows** | Scheduled job and flow execution status, failures and their errors, joined with the source in the mirror |
| T6 | **Drift** | Production metadata compared with the mirror and with what development delivered: emergency fixes made in production, changes that never went through an update set |

Every fix the investigation finds goes back through development: a branch, a change, a test, a
plan. The skill recommends the actions that only look like reads (debug properties, background
scripts) to a human, as ADR-0012 already says.

### 5.4 Govern: from guardrails to a governed pipeline

| ID | Capability | Why |
|---|---|---|
| G-1 | **Pull-request gate in CI** with SARIF and inline comments | ASR-03 says the gate runs in CI; there is no template. This is the team lead's view of snagentic |
| G-2 | **Governed mode** | CI pushes on merge; developers and agents hold no write credential. Designed in ADR-0004, unbuilt |
| G-3 | **Promotion guard** | Validate an update set before it is committed on test or production (A7), read-only there |
| G-4 | **Custom rule packs** | Customers add their own standards as declarative rules (ASR-11). Also the premium rule stream (ADR-0008) |

### 5.5 Priorities

Scored on the criteria of section 2, from 1 (low) to 5 (high). Safety cost is inverted: 5 means
no new risk. The weighted total is out of 65.

| Group | Hours (3) | Leverage (3) | Asset fit (2) | Defensibility (2) | Safety (2) | Time to value (1) | Total |
|---|---|---|---|---|---|---|---|
| Audit from the mirror (A1–A8) | 4 | 4 | 5 | 4 | 5 | 4 | **56** |
| Close the loop (D1–D4) | 5 | 5 | 4 | 3 | 4 | 3 | **55** |
| Governed pipeline (G-1 to G-4) | 3 | 3 | 5 | 4 | 5 | 4 | **50** |
| Upgrade preparation (A2, autopilot) | 5 | 4 | 3 | 3 | 4 | 2 | **49** |
| Story to change (D6) | 4 | 4 | 3 | 1 | 4 | 3 | **43** |
| Production investigation (T1–T6) | 4 | 4 | 3 | 4 | 1 | 1 | **41** |

Audit and closing the loop are a tie at the top, and they serve different buyers: the platform
owner and the developer. Production investigation scores lowest on safety and time to value, not
on value: it needs S6, the gateway and redaction before the first query. It still comes before
upgrade preparation (section 9), for two reasons: you asked for it explicitly, and upgrade
preparation is best delivered as the Steward's first job, which needs R1 to R3 underneath it.
Story to change scores low on defensibility, because ServiceNow ships it.

## 6. The MCP budget is the binding constraint

The server is at 13 tools, the ASR-09 cap. Sections 5.1 to 5.3 would add at least `test`,
`audit` and `investigate`. Raising the cap is easy and wrong: the eval baseline shows that more
always-loaded text lowers the pass rate (variant A 95%, C 82%).

Proposal for one ADR, decided with the eval harness, not by argument:

- Merge `plugins` and `plugin_activate` into one tool with an action (as `update_sets` already
  is); merge `status` into `doctor`. That frees two slots.
- Add `audit` (A1 to A6, reads the mirror) and `investigate` (T2 to T6, through the gateway, only
  registered for instances whose kind allows it).
- Fold `test` (D1) into the development loop as an action of an existing write tool, or spend
  the third slot on it.
- Measure each variant on the eval scenarios before and after; adopt only if the pass rate holds.

## 7. The out-of-the-box bet: the Steward

### The insight

Every capability above still waits for a human to ask. Yet most platform-team work is not asked
for; it is **owed**: debt nobody has time to pay, upgrade preparation that starts too late,
documentation nobody updates, findings from last year's health check that nobody fixed. Software
engineering solved part of this with bots that open pull requests on their own (Dependabot,
Renovate). ServiceNow has nothing like it, because until now nobody had the instance as files in
git with a safe write path.

snagentic already has every piece: a scheduled pull (ASR-06), whole-instance rules (A1), a gate
(ASR-03), pushes only to development (ASR-02), pull requests (ADR-0022) and a headless agent
harness (the eval runner already drives Claude Code headless).

### What it is

**The Steward is snagentic run on a schedule, by CI, as an autonomous member of the platform
team.** Each night or week it:

1. pulls the instance and commits the mirror;
2. runs the health report and compares it with last week's;
3. picks work from a backlog the platform owner controls (a file in the workspace): fix these
   rule findings, deactivate this dead code, document this process, prepare this upgrade;
4. for each item, runs a headless agent with snagentic's skills to make the change, its tests
   and its validation, on a branch;
5. pushes the change to a **development** instance, runs its tests there (D1), and opens a pull
   request with the evidence: what it changed, why, the tests that passed, the plan;
6. posts a digest: health trend, what it fixed, what waits for review, what it could not do.

**It never merges and never touches test or production.** A human reviews every pull request;
governed mode (G-2) delivers on merge. Every guarantee is the one snagentic already enforces.

### Why it is a big bet

| Lens | Argument |
|---|---|
| Customer outcome | The platform owner buys "debt goes down every week" and "the upgrade is prepared before it starts", not a tool their developers might use |
| Business model | Priced per instance or per outcome, recurring, sold to the platform owner (budget holder), not per developer seat |
| Moat | Needs the mirror, the rules, the gate and the safe write path together. A generic MCP server can't do it safely; ServiceNow's in-platform AI works inside a session a human opens |
| Competition | Autonomous Engineer, Echelon and RapDev APO build **stories** someone wrote. The Steward does the **owed** work nobody writes a story for, on the existing estate, in the customer's own git and CI, with no ServiceNow SKU and no hosted service |
| Partner channel | Partners sell managed services; the Steward is a managed service in a box. It can be white-labelled per partner |
| Data flywheel | Every accepted or rejected pull request teaches which fixes are welcome; that feeds rule calibration and the premium stream (ADR-0008) |

### Risks and how the design answers them

| Risk | Answer |
|---|---|
| Review fatigue: too many pull requests | A weekly budget of pull requests set by the owner; one theme per pull request; the backlog is opt-in |
| Wrong fixes at scale | Only rules with a deterministic fix at first (for example `isLoading` guards, sys_id constants into properties); every change passes the gate and its tests on development |
| Cost of model calls | Bounded per run; the backlog limits scope; cheaper models for documentation |
| Scope creep (v1's failure) | The Steward adds **no new engine**: it is a CI template, a backlog file and a skill, over capabilities built in R1 to R3. It ships last for that reason |

### Runner-up ideas

Each was considered and placed second for the reason given.

| Idea | What it is | Why not first |
|---|---|---|
| **Upgrade autopilot** | Before an upgrade, forecast skipped records (A2); after upgrading a development clone, three-way merge each skipped record (old out-of-box, new out-of-box, customer version) with an agent, with tests as evidence | Not a runner-up so much as **the Steward's defining job**. Upgrades take 1 to 2 months per cycle (section 4.3) and ServiceNow only summarizes skipped records. It needs an ADR (ADR-0010 excludes upgrade intelligence) and a spike to read both out-of-box versions. ServiceNow will likely move here, so speed matters |
| **Configuration time machine** | The mirror's git history as forensics: "what changed in the week before this started failing?", bisect of configuration, blame per field | Unique and cheap; best as part of T6 and T2, not a product of its own |
| **Access simulator** | Before pushing an ACL or role change, compute who gains or loses access to which tables and fields, from mirrored ACLs and role definitions | High value for security reviews, but evaluating ACL scripts offline is hard; start with non-scripted ACLs inside A4 |
| **Partner estate** | One view across many customer instances for a partner: compare, reuse patterns, benchmark health | ADR-0010 excludes estate features; valuable once several customers run the Steward |

## 8. How we will know it works

| Measure | Target for the pilot | How |
|---|---|---|
| Time from story start to change on development | Halved versus the team's baseline | Pilot scorecard: five comparable stories each way |
| Share of agent-delivered changes that pass review without rework | 70% | Pull request outcomes |
| Findings introduced per change that reach test | Down 80% | Gate history |
| Time to answer "what runs when…" questions | Minutes to seconds | Usage log (B8) |
| Instance load | Within ASR-16 | Pull reports |
| Developer retention after four weeks | Most of the pilot keeps using it | Usage log |

The eval harness keeps guarding the agent interface: every new tool or skill ships with
scenarios and a pass rate no lower than today's.

## 9. Sequencing

Each release is usable on its own, as ADR-0010 requires.

| Release | Theme | Contents | Exit criterion |
|---|---|---|---|
| **R0** | Pilot-ready | B1 to B10; read-side pilot with one team on 1.8 | A team uses find, describe, advise and validate weekly |
| **R1** | Close the loop | 2.0 (spec 008); D1 test on development, D2 author tests, D3 observe on development, D4 impact | An agent delivers a tested change on development without a human running anything in the browser |
| **R2** | Audit | A1 to A8, G-1 CI gate with SARIF, MCP consolidation (section 6) | A monthly health report a platform owner reads; update sets validated before promotion |
| **R3** | Investigate | Spike S6, T1 read gateway, T2 to T6 | A production incident investigated end to end, read-only, audited |
| **R4** | Steward | Scheduled agent, backlog, digest; upgrade autopilot as its first large job | A customer instance whose debt falls each month with no developer effort but review |

R1 comes before R2 because the pilot team are developers; R2 comes before R3 because audit needs
no production access and proves value to the budget holder with no new risk.

## 10. Decisions for the product owner

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 0 | Positioning | "Build ServiceNow with any agent" / "the independent outside view: understand, audit, guard, investigate" | The outside view (section 4.1); update the README and overview with it |
| 1 | Pilot now on 1.8 (read side) or wait for 2.0 | Now, read side / wait | Now, read side (B1) |
| 2 | Pilot license | Evaluation agreement / choose the core license now | Evaluation agreement; keep ADR-0008 open |
| 3 | Usage measurement | None / opt-in local log / remote telemetry | Opt-in local log the pilot shares (new ADR) |
| 4 | Test and observe on development (D1, D3) | In scope now / later | In scope for R1 (new ADR) |
| 5 | MCP surface consolidation | Raise the cap / consolidate / both | Consolidate, decided by the eval harness (new ADR) |
| 6 | Audit as a product line (A1 to A8) | Build in R2 / sell as premium | Build; premium rules on top (ADR-0008) |
| 7 | Upgrade intelligence | Keep excluded / ADR for A2 and the autopilot | ADR before R4; forecast (A2) earlier |
| 8 | The Steward | Pursue / park | Pursue as R4; validate with the pilot's platform owner in R2 |

ADRs this vision implies: test and observe on development; usage measurement; MCP consolidation;
audit reports; read gateway (designed in ADR-0012, needs its own); upgrade intelligence; the
Steward (autonomous agent runs and their limits).

## 11. What we say no to

- **An in-platform console or a ServiceNow app.** Different security model (ADR-0012 deferred it);
  competes with ServiceNow on its own ground.
- **Writes to production, ever, including "safe" ones.** Not even for the Steward.
- **Mirroring business data** to support troubleshooting. Read it live, redacted, bounded; never
  commit it.
- **A second MCP server** for audit or troubleshooting. One server, tools registered by kind.
- **Chasing every ServiceNow product area with accelerators** before the ITSM pack proves the
  mechanism.
