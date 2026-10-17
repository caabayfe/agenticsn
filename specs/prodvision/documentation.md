# Verified documentation: how to bring sndoc into snagentic

- Date: 2026-10-17
- Status: assessment for the product owner, before an ADR. **Followed up on 2026-10-17:** the product
  owner chose a process-then-capability structure written for consumers, a static HTML site, ffmpeg
  audio and video with optional voice. Built as ADR-0034 and spec 010 (PR #67); the pdi2 incident
  process was documented with it (20 pages, 140 evidence items, all anchored to mirror records)
- Inputs: `NTTMCIS/sndoc-revision` (read on 2026-10-17, 3 commits, 17 revised pages), ADR-0002,
  ADR-0010, ADR-0011, ADR-0012, ADR-0016, ADR-0026, `design.md` (this folder), market check of
  2026-10-17
- Collaboration: Tomasz Michalski (author of sndoc-revision) has agreed to work on this with
  snagentic

## 0. Conclusion

1. **Bring it in as a capability with three layers, owned in three places.** The packaging question
   is not "one MCP or two". It is which layer each part belongs to:

   | Layer | What | Where it lives | Why there |
   |---|---|---|---|
   | **Verify** | Claims anchored to instance metadata; stale, broken and missing documentation as findings | snagentic core (new `documentation` context) and a rule pack | It needs the mirror, the content hashes and the gate. A guarantee must be code (ADR-0011) |
   | **Author** | The review method: A and B pages, evidence, labels, change register | A skill, plus a context bundle from the CLI | Writing is the model's job; the method is guidance |
   | **Render and publish** | Confluence storage format, HTML, narrated animations | A separate package owned with Tomasz (today's sndoc pipeline) | Different stack (Python, GPU, ffmpeg), different licences, different release cadence, a human publishes |

2. **The MCP surface is a second server from the same binary, for a different person, added only
   when a writer's host needs it.** ADR-0002 rejected several servers because a host loads all of
   them and the agent has to choose between overlapping paths. That objection holds inside one
   session. It does not hold when the person and the host are different: a platform owner writing
   documentation in Claude Desktop never loads the developer server. The generator already builds a
   server from any list of use cases, so the cost is configuration, not code. Phase 1 needs no MCP
   tool at all.
3. **The differentiator is documentation that knows when it is wrong.** Generating text from
   configuration is already on the market (section 2). Keeping each statement tied to the record it
   describes, and flagging it when that record changes, is not. That's the part only a mirror with
   content hashes can do cheaply, and the part to build first.
4. **Before any code:**
   - a spike (the documentation spike) to measure how much of a real page can be anchored;
   - one ADR for the new context and the server-per-person rule;
   - a written agreement with NTT on the method and the pipeline.

## 1. What sndoc-revision is

It is a **method executed by an assistant, plus a rendering pipeline**. It doesn't extract
documentation from code by itself. Each page was produced by reading the old Confluence page,
checking every statement against production (read-only), and writing two new pages.

| Part | Content | Reusable for snagentic |
|---|---|---|
| Method (`docs/method.md`) | Read-only verification; evidence rows (ID, what, where and how, result); labels NEW, CORRECTED, RESTORED, CHANGED, DOCUMENTED ONLY, OPEN QUESTION; A page (user guide, task order) and B page (technical reference with the review record); no customer data; figures are snapshots | **Yes, all of it.** It becomes the skill and the doc format |
| Pages (`pages/*/confluence/*.xml`) | 17 subjects of one NTT production instance, Confluence storage format | **No.** NTT content. Useful only as a quality bar (B4 *Triage case configuration* is the best) |
| Scene format (`animation.json`, `scene.svg`, `steps.json`, `vo_script.json`) | 5 to 8 steps, each with title, caption, narration, subtitle and camera | Yes, as the contract between authoring and rendering |
| Pipeline (`tools/`, about 2,000 lines of Python) | Narration with Breeze TTS 2 (GPU), ASR check, mix, single-file HTML player, transcript, Confluence embedding, manifest of published hashes | Stays a separate package (section 5.3) |

What the method does that matters most:

- it treats an existing page as **claims to verify**, not text to rewrite;
- it records **where the old page was wrong** (CORRECTED);
- it says **what wasn't proven** (DOCUMENTED ONLY, "not tested").

What it doesn't do: anything after publication. A page reviewed on 26 September is unverified on
27 September if a business rule changes, and nothing notices.

## 2. Market position

| Offer | What it does | What it lacks |
|---|---|---|
| Now Assist for Creator (ServiceNow) | App, table and flow summaries; the release lifecycle documentation agent (Australia) writes update set descriptions and release notes | Per artifact or per release; no evidence; no staleness; licensed per instance |
| DocuHub AI Agent (ServiceNow Store) | Technical and business documents from update sets and workflows | Per update set; generated once |
| Echelon, Trupeer and others | Documentation advice, capture of configuration screens | Not anchored to records |
| **sndoc method + snagentic mirror** | Documentation of a **subject** across the whole customised platform; every claim has evidence; **stale claims are found automatically**; old pages corrected | Doesn't exist yet |

"Nobody has documentation" is not true. "Nobody has documentation that stays true" is, as far as
the check of 2026-10-17 found.

## 3. What the capability must guarantee

| ID | Requirement | Enforced by |
|---|---|---|
| DOC-1 | Every technical claim cites at least one anchor: table, sys_id, optional field, content hash at review time | `docs check` (code) |
| DOC-2 | A claim whose anchor changed or disappeared is reported, with the old and new hash | `docs check`, as governance findings in CI and pre-commit |
| DOC-3 | Customisations that no page covers are listed (coverage) | `docs coverage` |
| DOC-4 | No business records, no customer names, no secret property values on any page | The mirror's redaction (ASR-08) and a doc rule on page text |
| DOC-5 | Production is only read, and only from the mirror | ADR-0012 profile; no new live production reads in phase 1 |
| DOC-6 | Publishing to Confluence or anywhere else is a human action | No publish use case in snagentic |
| DOC-7 | Narration and media respect their licences | Renderer package; Breeze TTS 2 is research and non-commercial (sndoc `docs/setup.md`) |

## 4. Fit with snagentic today

| sndoc needs | snagentic has | Gap |
|---|---|---|
| Business rules, script includes, UI actions, UI policies, client scripts, ACLs, dictionary, choices, flows, notifications | Mirrored, with content hashes; `describe` gives table behaviour in execution order | None |
| Inbound email actions (`sysevent_in_email_action`) | Not mirrored | Register the artifact type |
| Modules and menus (`sys_app_module`, `sys_app_application`) | Not mirrored | Register the artifact types |
| Roles and role containment (`sys_user_role`, `sys_user_role_contains`) | Not mirrored | Register the artifact types |
| Property values | Redacted unless on the reviewed allowlist (`metadata/domain/redaction.ts`) | Keep it. The page names a property and says "value not reproduced" unless allowlisted |
| Usage figures ("5,221 active holders", "never used") | None: pull reads only `sys_metadata`, and ADR-0016 forbids row counts | New read-only aggregate read, its own ADR (section 6) |
| Old page to revise | None | Import of a Confluence storage body as **untrusted input** |
| Behaviour that only running proves | Nothing in production, by design | Stays DOCUMENTED ONLY, as in sndoc |

By my reading of B4, about 80% of what it cites is mirrored today (an estimate; the spike measures it). The rest is three artifact types, a count, and an
import.

## 5. Packaging options

### 5.1 The options

- **A. Same server, more tools.** Add `doc_context`, `doc_check` and `doc_coverage` to
  `snagentic mcp`.
- **B. Same binary, a second server per person.** `snagentic mcp --server docs` exposes a docs set
  (find, describe, doc context, doc check, coverage). Developers keep the 13 tools they have.
- **C. A separate product.** sndoc becomes a tool of its own that reads snagentic's mirror through
  files and the CLI.
- **D. Layered (recommended).**
  - Verification goes into snagentic core and surfaces as findings of the existing `validate`.
  - Authoring is a skill.
  - Rendering stays a separate package with a versioned bundle contract.
  - The MCP surface is option B, when it's needed.

### 5.2 Assessment

The scale is 1 (bad) to 3 (good).

| Criterion | A | B | C | D |
|---|---|---|---|---|
| Staleness is enforced, not advised (ADR-0011) | 3 | 3 | 1: a second tool re-derives hashes or trusts snagentic's | 3: findings in the same gate as code |
| Standing context for developers (ASR-09; eval: variant A 95%, C 82%) | 1: 13 → 16 tools for everyone | 3 | 3 | 3 |
| Reuses mirror, redaction, read-only profiles | 3 | 3 | 2: through a file contract | 3 |
| Collaboration and independent cadence with Tomasz | 1 | 1 | 3 | 3: renderer is theirs |
| Licence and stack isolation (Python, GPU, Breeze) | 1 | 1 | 3 | 3 |
| Reaches writers who don't use a coding agent | 2 | 3 | 2 | 3 (with B) |
| Commercial separability (ASR-14) | 1 | 2 | 3 | 3: the doc rule pack can be premium |
| Time to first value | 2 | 2 | 2 | 3: phase 1 is CLI, skill and rules, no MCP |
| Few moving parts | 3 | 2 | 2 | 1: two repositories and a versioned contract |
| **Total** | **17** | **20** | **21** | **25** |

### 5.3 Why D

- **Verification has to sit next to the mirror.** Staleness is a hash comparison against the
  snapshot snagentic already keeps. Put elsewhere, it duplicates the mirror or trusts it blindly.
  As findings of `validate`, a stale page shows up in the same pull request as the change that
  made it stale. That's the moment someone can still fix it, and it's a moment no competitor has.
- **Authoring is guidance.** sndoc's method is exactly what a skill is for: knowledge loaded on
  demand. A skill costs no standing context.
- **Rendering is a different product.** The pipeline needs Windows or a GPU, ffmpeg and model
  weights, and its voice is licensed for non-commercial use only. In the TypeScript binary that
  breaks the size and dependency rules (ADR-0005) and ties releases together. As a separate package
  behind a bundle contract, Tomasz keeps ownership, and it can swap in a commercially licensed
  voice without touching snagentic.

### 5.4 The second server: when it earns its place

ADR-0002 and ADR-0010 reject several MCP servers, for three reasons:

- hosts load the union of their tools;
- configuration multiplies;
- the agent must choose between overlapping paths.

Re-examined:

| Objection | Holds when | Doesn't hold when |
|---|---|---|
| Union of tools | One session loads both servers | Each person loads one: a developer in Claude Code, a writer or platform owner in Claude Desktop |
| Configuration multiplies | Users configure both by hand | `snagentic agents install --persona docs` writes it, as it does now per host |
| Overlapping paths | The same question is answered by two tools in one session | Shared read tools (find, describe) appear in both servers, but never in the same session |

Proposed rule for the ADR, amending ADR-0002 point 3:

- **one server per person**, built from the registry;
- **a budget per server** (13 for the developer server, 8 for docs);
- **write tools in exactly one server**;
- **no session configured with two servers** (enforced by `agents install`).

The generator (`createMcpServer` takes any list of use cases) and ADR-0012's per-kind
registration already support this.

**When.** Not in phase 1. Developers and Tomasz work in coding agents, where the CLI and the skill
are enough. Add the docs server when a pilot has a writer or platform owner working in a desktop
chat host.

## 6. Design sketch

### 6.1 The page source

A page is Markdown in the workspace, next to the mirror, for example `docs/sn/B4-triage.md`.
Claims cite evidence IDs; the evidence lives in front matter:

```markdown
---
code: B4
title: Triage case configuration
audience: technical          # technical | user-guide
pair: A4
reviewed: 2026-09-26
instance: prod               # a profile name, never a URL with credentials
evidence:
  E07:
    anchor: sys_script_include/9f1c…#script@sha256:4be1…
    how: read the function createDefaultInteraction
    result: one user → contact, company, Default Support Team
  E12:
    anchor: sys_properties/ntt.eth.default_mail_interaction
    how: property record
    result: value not reproduced (not on the allowlist)
---

## 2. Email channel {label=CORRECTED}

When one active user has the sender address, the case gets that user, their company and the
company's Default Support Team. [E07]
```

### 6.2 New core context `documentation`

| Layer | Contents |
|---|---|
| `domain/` (pure) | `DocPage`, `Claim`, `Anchor` (parse and print), `Label`; `assessClaims(page, snapshot)` → fresh, changed, missing; `coverage(pages, customisations)` |
| `application/` | `checkDocs`, `docCoverage`, `docContext(subject)` (a bundle of the artifacts behind a subject, from the knowledge graph), `exportDocs(format)` |
| `ports.ts` | Page store (files), snapshot reader (from `metadata`), knowledge queries (through the knowledge application service) |
| Rule pack `rules-docs` | SN-DOC-001 anchor missing, SN-DOC-002 anchor changed since review, SN-DOC-003 claim without evidence, SN-DOC-004 secret or customer text on a page, SN-DOC-005 customisation without a page (coverage, advisory) |

`validate` runs the doc rules when the workspace has pages. That reaches CI, pre-commit and the
push gate with no new interface. SARIF output and waivers work as for code.

### 6.3 Interfaces

| Interface | Phase 1 | Later |
|---|---|---|
| CLI | `docs context <subject>`, `docs check`, `docs coverage`, `docs export --format md\|confluence\|bundle` | `docs import <confluence storage file>` (untrusted input) |
| Skill | `document`: sndoc's method (verify, A/B, labels, change register, open questions), using find, describe and `docs context` | `revise`: the sndoc flow for an existing page |
| MCP | None. Developers see doc findings through `validate` | Docs server (section 5.4) |
| Bundle | `docs export --format bundle`: JSON with pages, evidence and an optional scene (sndoc's `steps.json` shape), versioned | The renderer reads it; snagentic never runs the renderer |

### 6.4 The Steward link

The Steward (`design.md` section 7) already watches the instance and opens pull requests. With
DOC-2 it gets a second job:

1. a change makes claims stale;
2. the Steward drafts the page update with the `document` skill;
3. it adds that update to the same pull request.

Documentation stops being a project and becomes a side effect of every change.

## 7. ADRs needed

| ADR | Decides | Amends |
|---|---|---|
| Verified documentation | Adds the `documentation` context, the page format, the doc rule pack and the CLI commands to scope | ADR-0010 |
| One MCP server per person | Server per person, budget per server, write tools in one server, one server per session | ADR-0002, ADR-0010 ("multiple MCP servers") |
| Mirror for documentation | Inbound email actions, modules and roles as artifact types | ADR-0010 if the types are outside the v1 list |
| Usage figures | A bounded, read-only aggregate read (counts by indexed fields only, through the scheduler, never records, cached in the snapshot with its date) | ADR-0016 (no row counts) |

The usage-figures ADR is the only one that touches a safety rule. It can wait: phase 1 marks
figures as "not measured".

## 8. Working with Tomasz

| Topic | Proposal |
|---|---|
| Ownership | snagentic owns verification, the page format and the skill. Tomasz owns the renderer and the method's evolution; the skill cites them as author of the method |
| Contract | The bundle format, versioned, with golden files in both repositories |
| Code | Nothing copied from `sndoc-revision`. The skill is rewritten from `docs/method.md`, with Tomasz reviewing it |
| Content | No NTT pages, property names or figures in snagentic, its tests or its fixtures. Examples use the PDI's out-of-box configuration |
| IP | `sndoc-revision` is in the `NTTMCIS` organisation. Tomasz agreeing is necessary but may not be sufficient: get NTT's written OK for the method and the renderer to be used with a personal project, before phase 2 |
| Licences | The renderer keeps Breeze TTS 2 for internal NTT material only; anything shipped with snagentic needs a commercially licensed voice |

## 9. Phases

| Phase | Delivers | Exit test |
|---|---|---|
| **Documentation spike** | One out-of-box subject on pdi2 (incident assignment), written to the method from the mirror; then one deliberate configuration change | Share of claims anchorable (target ≥ 80%); `docs check` catches the change; cost and time per page |
| **P1 Verify** | `documentation` context, page format, `docs check`, rules SN-DOC-001 to 004, `document` skill | `validate` fails a pull request that makes a page stale |
| **P2 Cover and export** | `docs coverage`, export to Markdown, Confluence storage and bundle; the three artifact types | A full A/B pair exported and published by hand |
| **P3 Render** | Tomasz's renderer reads the bundle; optional docs MCP server | An animation built from a bundle with no hand edits |
| **P4 Steward** | Stale claims trigger a drafted page update in the Steward's pull request | A change and its doc update reviewed together |

## 10. Risks

| Risk | Answer |
|---|---|
| Anchors too coarse: a script changes for an unrelated reason and every claim on it goes stale | Anchor to a field, and later to a function inside a script (the ESLint AST is already there); "changed" is a review prompt, not a failure, unless the page is marked strict |
| Writers ignore the findings | Same answer as code: the gate, plus the Steward drafting the fix |
| Old pages carry prompt injection or customer data | Imports are untrusted data, redacted before disk, never instructions (ADR-0012 reasoning) |
| A docs server drifts into a second product | Built from the same registry; budget test per server; no write tools |
| The renderer's licence leaks into a commercial release | The renderer isn't shipped by snagentic; the bundle carries no audio |

## 11. Decisions for the product owner

1. Accept the three-layer split (verify in core, author as skill, render as a separate package)?
2. Accept "one MCP server per person" as the ADR direction, with the docs server deferred until a
   pilot needs it?
3. Run the documentation spike on pdi2 now? (Done differently: see the status line.)
4. Who asks NTT for the written OK (section 8), and before which phase?
