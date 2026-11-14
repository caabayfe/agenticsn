# snagentic product videos

Four short narrated videos on why to use snagentic and how, made with snagentic's own documentation
capability (`docs build`, `docs video`; [generate documentation](../../docs/guides/generate-documentation.md)).

| Video | For | Length |
|---|---|---|
| `whysn`: Why snagentic | the problem and the benefit | about 1 minute |
| `howsn`: How snagentic works | pull, understand, edit, validate, plan, push | about 1 minute |
| `safesn`: Safe by design | what snagentic will never do | about 1 minute |
| `docsn`: Documentation that stays true, and onboarding | verified docs and `snagentic onboard` | about 1 minute |

The MP4s are in [`videos/`](videos/). Their sources, one folder per video under
`documentation/animations/` (`scene.svg`, `scene.css`, `steps.json`, `animation.json`), are what to edit.

## What is and isn't verified

The capability's evidence model ties claims to records in an instance's mirror, which doesn't apply to a
product. These videos carry no evidence. Each animation names, in its tag and footer, the product document
its claims come from, and `tests/tooling/product-docs.test.ts` checks the counts they quote (rules, MCP
tools, skills) against the code. Anything else a video says is checked by whoever changes the document it
comes from: change the document, then the animation.

## The voice

The narration is Piper's `en_US-lessac-medium`, chosen by the product owner (2026-11-14) after listening to the
alternatives. **Check its license before the videos leave the company**: the model is kept in a `non-commercial/`
folder on the machine that made them, and its license has not been confirmed. For public use, re-record
with a public-domain voice such as `en_US-ljspeech-high`, which `--voice piper` picks when no model is named.

## Make them again

This folder is a documentation workspace without a git repository of its own (the repository's `.snagentic/`
folder is ignored). From here:

```sh
snagentic docs check                    # the animations are well formed
export SNAGENTIC_PIPER_MODEL=~/.local/share/snagentic/piper/voices/non-commercial/en_US-lessac-medium.onnx
snagentic docs video whysn --voice piper
snagentic docs build --voice piper      # a site in .snagentic/site/, to preview with: snagentic docs serve
cp .snagentic/videos/*.mp4 videos/      # the videos are committed
```

Needs `ffmpeg`, Chrome and [Piper](https://github.com/rhasspy/piper) with a voice model (`SNAGENTIC_PIPER` and
`SNAGENTIC_PIPER_MODEL` name them; by default `~/.local/share/snagentic/piper`). Without Piper, `--voice system`
uses the operating system's voice. Re-record a video after changing its steps, and commit it.
