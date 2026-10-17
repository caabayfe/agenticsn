# 010. Verified documentation site: plan

- Status: P1, P2 and P3 done (2026-10-17); three audiences done (`audiences.md`, A1–A4); P4 next
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

Documentation is organised **by process, then by capability**, and written for the process's
consumers (revised 2026-10-17: the process can't be guessed from code; the user guide is for the
people who use the platform, the technical page for its owner).

```
documentation/
  site.yaml                               title, instance, footer
  processes/
    incident/
      process.yaml                        summary, roles, lifecycle, capabilities (ordered, with roles)
      overview.guide.md                   what the process is for, when to use it, the words people need
      overview.technical.md               optional: how the whole process is configured
      report.guide.md                     user guide of one capability, for its roles
      report.technical.md                 the records behind it, with evidence
      …
  animations/<name>/                      animation.json, scene.svg, scene.css, steps.json
```

### process.yaml

```yaml
title: Incident management
summary: Get people working again as fast as possible when something breaks.
order: 1
roles:
  - { id: caller, name: Caller, description: anyone who reports that something is not working }
  - { id: agent, name: Service desk agent, description: logs, sorts and routes incidents }
lifecycle:
  - { state: New, meaning: logged, nobody is working on it yet }
capabilities:
  - { id: report, title: Report an incident, roles: [caller], summary: Tell IT what is wrong }
```

### Pages

Front matter: `title`, optional `reviewed`, and `evidence` (E01, E02, … each with `record:
<table>/<sys_id>`, optional `field`, `how`, `result`, and `hash`, written by `docs pin`). Claims
cite evidence as `[E01]`. Guides may carry evidence too; the site folds it under "How this guide
was checked". Labels on headings: `{label=NEW}`, `CORRECTED`, `RESTORED`, `CHANGED`,
`DOCUMENTED-ONLY`, `OPEN-QUESTION`. `{{animation:<name>}}` alone on a line embeds the player and
its transcript.

### The site

- `index.html`: the processes.
- `processes/<p>/index.html`: summary, who it is for (each role and where it starts), lifecycle,
  overview, numbered capabilities with links to their guide and configuration.
- `processes/<p>/<capability>.html`: the guide, with its number, roles, previous and next
  capability, and a link to how it is configured. A stale technical page shows a plain-language
  notice on the guide.
- `processes/<p>/<capability>.technical.html`: the technical page with its evidence table.

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
| **A1–A4 Audiences** | Understand, Use, Operate and Configure sections (`audiences.md`, done) | See `audiences.md` §6 |
| **P4 Gate** | Doc findings in `validate` (CI, pre-commit, push gate); coverage of customisations without pages; Steward drafts page updates | A pull request that changes an anchored record shows the stale page |

## 4a. Audio (P2, done)

`snagentic docs build --audio` adds music and sound effects to every animation; `--voice
piper|system` also narrates each step (`say`). The track is embedded in the animation page
(data URI) and written beside it as `animations/<name>.mp3`.

- The mix is pure TypeScript (`domain/mix.ts`) with the SNDOC parameters: voice at -19 dB RMS,
  0.7 s lead, voice 0.35 s after each step start, 0.95 s gap, 2.2 s tail; whoosh -21 dB before and
  pop -25 dB after each step; cues from `animation.json` `mix.cues` ([step, offset, sound, dB]);
  closing sound at the end -3.2 s; bed at -21 dB RMS, ducked -9.5 dB under the voice (attack
  0.25 s, release 0.7 s), fades 1.2 s and 2.6 s, summed at -3 dB; tanh soft limiter at 0.97.
- Without voice the steps follow the player's estimate, so the silent visuals and the track agree.
- Sounds and the bed are synthesised (deterministic) unless the workspace provides
  `documentation/audio/bed.<ext>` or `documentation/audio/sounds/<name>.<ext>`.
- ffmpeg decodes and encodes (loudnorm -16 LUFS, 64 kbit/s mono MP3). Missing ffmpeg or voice is
  a precondition error naming the fix.
- Voices: Piper (`SNAGENTIC_PIPER`, `SNAGENTIC_PIPER_MODEL`, or `~/.local/share/snagentic/piper/`
  with `.venv/bin/piper` and `voices/*.onnx`; it must live under a short path, its espeak-ng
  data fails to load from long ones), and the system voice (macOS `say`, `espeak-ng` elsewhere).
  Each spoken line is cached in `.snagentic/docs-cache/voices/` by voice and text.

## 4b. Video (P3, done)

`snagentic docs video <animation> [--voice piper|system] [--fps 30]` writes
`.snagentic/videos/<animation>.mp4` (H.264, AAC): music and effects always, narration and
subtitles with a voice.

- Spike S20 (2026-10-17): DevTools virtual time advances JavaScript time and timers, but not
  CSS transitions (camera moves and reveals stayed at their start). So the recorder plays the
  animation in **real time** in headless Chrome (`--headless=new`), captures the screencast
  (frames pushed on change, each with its wall-clock time), and ffmpeg resamples it to a
  constant frame rate (concat list from `domain/video.ts`) and muxes the P2 track. A recording
  takes as long as the animation (a 26 s animation: 31 s in all).
- The player has a recording mode (`#record`, `#subs`): no controls, no autoplay or loop, started
  by the recorder, which reads the start time from the page.
- The browser is `SNAGENTIC_CHROME`, or Chrome or Chromium at their usual paths. The DevTools
  client is a small WebSocket client in the adapter (no npm dependency).
- CI installs ffmpeg; the runner image has Chrome, so the recording test runs there.

## 5. Safety

- Reads only the mirror and the workspace; no instance request (ADR-0016 unaffected).
- Redaction already happened at pull (ASR-08): pages can only cite what the mirror holds.
- The site is written under `.snagentic/` and never committed.
- Scene SVG and `on` scripts are author content. They run only inside the sandboxed animation
  iframe, never in the page.
- `docs serve` binds to `127.0.0.1` only.
- External programs (ffmpeg, Piper, say, Chrome) are run with argument lists, never a shell;
  narration text goes through a file. Chrome runs headless with a throw-away profile, on a local
  file, and is killed after recording.
