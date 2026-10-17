# 0035. Verified documentation: pages anchored to the mirror, published as a static site

- Status: Accepted (product owner, 2026-10-17)
- Date: 2026-10-17
- Requirements: G2 (explain and assess an instance), G3 (guardrails), ASR-01, ASR-08, ASR-09,
  ASR-10, ASR-13, ASR-15
- Amends: 0010 (adds verified documentation to scope)
- Relates to: 0002 (agent interface), 0011 (enforcement layers), 0012 (production read-only),
  0016 (instance load), 0017 (mirror paths)
- Plan: `specs/010-verified-documentation/plan.md`
- Assessment: `specs/prodvision/documentation.md` (branch `docs/product-vision`)
- Proposed amendment: `specs/010-verified-documentation/audiences.md` (decision 2: four
  sections for end users, operators and the platform team; awaiting the product owner)

## Context

ServiceNow practices struggle to keep user and technical documentation of their instances. Pages
are written once and go wrong with the next change. A manual method proven at NTT (the SNDOC
revision, September 2026) produced good pages:

- every statement checked against the instance and recorded as evidence;
- a user guide page (A) and a technical page (B) per subject;
- labels for what changed against the old page;
- a narrated SVG animation for what moves.

It needed an assistant reading production by hand, and nothing noticed when a page went stale.

snagentic already holds what that method needs: the mirror of the instance's metadata, with a
content hash per record, the knowledge index, and the read-only production profiles.

## Decision

1. **A documentation context in core** (`packages/core/src/documentation`). Pure domain, ports,
   application services, as every context (ADR-0001).
2. **Sources live in the workspace, in git**, under `documentation/`, organised **by process,
   then by capability**, for the process's consumers (revised 2026-10-17, product owner: the
   process cannot be guessed from code, and the guide is for the people who use it):
   - `site.yaml`: title, the instance documented, footer;
   - `processes/<process>/process.yaml`: the process as its consumers see it — summary, roles,
     lifecycle, and capabilities in the order people meet them, each with its roles;
   - `processes/<process>/overview.guide.md` and, per capability, `<capability>.guide.md` (the
     user guide, for the capability's roles) and `<capability>.technical.md` (for the platform
     owner);
   - `animations/<name>/`: `animation.json`, `scene.svg`, optional `scene.css`, `steps.json`.

   The agent writes them, guided by a skill that starts from the consumer (roles, lifecycle,
   menus, forms, buttons, notifications, SLAs) and uses the code as evidence, not as the story.
   snagentic never generates the prose.
3. **Claims are anchored.** A page's front matter lists its evidence. Each item names a mirror
   record (`<table>/<sys_id>`), optionally one field, and the hash the claim was verified
   against. The body cites evidence as `[E01]`.
4. **`docs check` enforces it, in code (ADR-0011).** It reports:
   - evidence whose record is gone (missing);
   - evidence whose hash no longer matches the mirror (changed);
   - evidence not yet pinned;
   - citations of unknown evidence;
   - technical pages with no evidence.

   It exits non-zero on missing, changed or unknown. `docs pin` records the current hashes after
   the author has re-verified.
5. **Output is a static site** that any web server can serve: plain HTML, CSS and JavaScript,
   with no server code and no external requests. `docs build` writes it to
   `.snagentic/site/` (git-ignored, ADR-0014); `docs serve` serves it on `127.0.0.1` for
   preview.
6. **Animations are self-contained HTML pages**, embedded in the pages through a sandboxed iframe
   (`sandbox="allow-scripts"`, so the scene's script can't reach the page). Every animation has a
   text transcript on its page.
7. **Media is optional and runs through ports.** Phase 2 adds an audio track mixed by ffmpeg
   (music and effects always, voice optional) and phase 3 an MP4 export. The voice is a port: Piper
   by default (local), the operating system's voice as a fallback, a cloud adapter later.
   ffmpeg, Piper and the browser used for video are external programs. They are found on the
   machine and never bundled. A missing program disables only its step.
8. **No new MCP tool.** The capability is CLI commands and a skill (Tier 0 and 1, ADR-0002). A
   separate documentation MCP server is a later decision, if a non-developer host needs one.
9. **Documentation reads the mirror only.** It adds no request to any instance. Usage figures,
   which would need aggregate reads, are out of this ADR.

## Consequences

- A page states which records it rests on, and a change that makes it wrong fails the check, in
  the same pull request.
- Pages can document production through a read-only mirror, with no load on production.
- The site needs no server code, so it can be published by any static host. Publishing is a
  person's action.
- Writers must keep evidence in front matter. That's the cost of verification; the skill does
  most of it.
- The player is browser JavaScript shipped as a string in core. It's tested for its build output,
  not in a browser, until the video phase adds a headless browser.

## Alternatives considered

- **Generate pages from the mirror without an agent.** Rejected: tables of fields are not a user
  guide. The value is the explanation, which needs a model, and the evidence, which needs code.
- **Confluence as the output.** Rejected for now: a static site is simpler, private by default
  and host-independent. A Confluence export can be added on the same page model.
- **Embed ffmpeg and a voice model in the binary.** Rejected: size, licences and platform builds.
  External programs, found at run time, keep the binary small and the media optional.
- **Port the original Python pipeline as is.** Rejected: snagentic is TypeScript on Bun, and its
  boundary, size and test rules apply. The method, formats and player behaviour are kept; the
  code is rewritten test-first.
