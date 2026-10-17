# 009. Verified documentation site: plan

- Status: P1 done (2026-10-17): verify passes; checked by hand against copies of three pdi2 rules, served by a plain static server. P2 next
- Date: 2026-10-17
- Decision: ADR-0034
- Requirements: G2, G3, ASR-01, ASR-08, ASR-09, ASR-10, ASR-13, ASR-15
- Origin: the SNDOC revision method and pipeline (NTT, September 2026), rewritten in TypeScript
  for snagentic. Kept: the method (evidence, A and B pages, labels), the scene format, the
  player's behaviour and the mix parameters. Changed: output is a static site, not Confluence;
  claims are anchored to the mirror and checked; voice is optional; video is added.

## 1. What the user gets

```
snagentic docs check            # are the pages still true? (CI, pre-commit)
snagentic docs pin [page]       # record the current hashes after re-verifying
snagentic docs build            # write the site to .snagentic/site/
snagentic docs serve [--port]   # preview it on http://127.0.0.1:<port>/
```

Phase 2 adds `docs build --audio` (and `--voice`), phase 3 `docs video <animation>`.

## 2. Workspace sources

```
documentation/
  site.yaml                         title, instance, footer
  pages/
    A4-triage-cases.md              user guide (audience: guide)
    B4-triage-configuration.md      technical reference (audience: technical)
  animations/
    tri/
      animation.json                name, title, heading, tags, viewBox, footer, mix cues
      scene.svg                     the <svg> element with <g id="cam">
      scene.css                     optional scene CSS
      steps.json                    [{t, c, say, sub?, cam?, on?}]
```

### site.yaml

```yaml
title: Incident platform documentation
instance: pdi2
footer: Prepared with snagentic. Figures are a snapshot of the review date.
```

### A page

```markdown
---
code: B4
title: Triage case configuration
audience: technical         # guide | technical
pair: A4                    # the page with the same subject for the other audience
reviewed: 2026-10-17
evidence:
  E01:
    record: sys_script_include/9f1c0000000000000000000000000001
    field: script           # optional: anchor one field, not the whole record
    hash: 4be1…             # written by `docs pin`
    how: read the function createDefaultInteraction
    result: one user → contact, company and Default Support Team
---

## Email channel {label=CORRECTED}

When one active user has the sender address, the case gets that user and their company. [E01]

{{animation:tri}}
```

- Labels: `NEW`, `CORRECTED`, `RESTORED`, `CHANGED`, `DOCUMENTED-ONLY`, `OPEN-QUESTION`, on a
  heading as `{label=…}`.
- `{{animation:<name>}}` alone on a line embeds the player, followed by its transcript.
- The technical page renders its evidence table from the front matter: ID, how, record, result,
  status at build time.

### Anchors and hashes

| Anchor | Hash compared |
|---|---|
| `record` only | the record's content hash (`_meta.hash`, hash contract v1, ADR-0017) |
| `record` + `field` | SHA-256 of the field's text: the YAML value, or the field's own file (`<base>.<field>.<ext>`) |

## 3. Architecture

```
packages/core/src/documentation/
  domain/      page.ts (front matter, citations, labels), evidence.ts (anchor parse, status),
               scene.ts (steps, timeline estimate), site.ts (navigation, page HTML),
               player.ts (player page HTML), player-script.ts, player-style.ts, errors.ts
  application/ check-docs.ts, pin-docs.ts, build-site.ts
  ports.ts     DocumentationSources, MirrorRecords, MarkdownRenderer, SiteOutput
packages/cli/src/adapters/documentation/
               fs sources (YAML front matter), mirror records (glob by table and sys_id),
               Bun.markdown renderer, site writer, static server (Bun.serve)
packages/cli/src/registry/
               docs-check.ts, docs-pin.ts, docs-build.ts, docs-serve.ts   (mcp: false)
packages/agent-packs/src/skills/document.ts   the method, as the `servicenow-document` skill
```

Rules kept from the original:

- the player: autoplay muted when in view, loop with a 2.6 s hold, camera fit, step reveal
  classes (`.s<k> .g<k>`, `.at<k>`), keys (Space, arrows, M, C), reduced motion shows the last
  step;
- the timeline without audio: each step lasts `max(4.2, words / 2.55 + 1.5)` s, first start
  0.6 s, total + 1.6 s.

## 4. Phases

| Phase | Delivers | Exit test |
|---|---|---|
| **P1 Site** | Formats; `docs check`, `docs pin`, `docs build`, `docs serve`; silent player; skill | A sample workspace builds; a changed mirror record fails `docs check`; the site opens from a dummy server |
| **P2 Audio** | ffmpeg adapter; the mix in pure TypeScript (timeline, RMS levels, ducking, fades, limiter) with the original parameters; synthesised default effects and bed, or configured assets; voice port with Piper and OS voice adapters; `--audio`, `--voice` | Without voice: music and effects follow the estimated timeline. With voice: timing comes from the clips. Golden test on the timeline and the sample arithmetic |
| **P3 Video** | `docs video <animation>`: the player rendered in a headless browser (system Chrome over CDP), frames to ffmpeg, muxed with the P2 track, MP4 H.264 | Spike S20 first: deterministic frame stepping versus screencast |
| **P4 Gate** | Doc findings in `validate` (CI, pre-commit, push gate); coverage of customisations without pages; Steward drafts page updates | A pull request that changes an anchored record shows the stale page |

## 5. Safety

- Reads only the mirror and the workspace; no instance request (ADR-0016 unaffected).
- Redaction already happened at pull (ASR-08): pages can only cite what the mirror holds.
- The site is written under `.snagentic/` and never committed.
- Scene SVG and `on` scripts are author content. They run only inside the sandboxed animation
  iframe, never in the page.
- `docs serve` binds to `127.0.0.1` only.
