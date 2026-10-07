# 0020. Instance kind and address are trusted from outside the repository

- Status: Proposed
- Date: 2026-10-07
- Requirements: ASR-02, ASR-08, ASR-15
- Amends: 0012 (production read-only by construction), 0014 (workspace layout)
- Relates to: 0011 (enforcement layers)

## Context

ADR-0012 makes test and production instances read-only through four layers. Layers 3 (write
use cases are not registered) and 4 (the credential must hold `snc_read_only`) both decide
from `kind` in `instances/<name>/instance.yaml`. Which host the credential is sent to comes
from `url` in the same file.

That file is committed and readable by the agent. The agent hooks protect it from the
agent's edit tools, but a shell command (`sed -i`), another tool or a malicious commit can
still change it. The 2026-10 security review found:

1. **Changing `kind` from `production` to `development` turns off layers 3 and 4.** Only the
   credential's own roles (layer 1) then protect the instance.
2. **Changing `url` in CI or env mode sends the secret to another host.**
   `SNAGENTIC_<NAME>_PASSWORD` is keyed by the instance name, not the host. The keychain is
   keyed by `<username>@<host>`, so the attacker's host finds no keychain secret there.

What is already fixed: the username is checked again on every read, requests never follow
redirects, and protected paths include `instance.yaml` (agent edit tools only).

## Decision (proposed)

1. **A local trust record outside the repository.** `snagentic instance add` also writes
   `<name>: {url, kind}` to the user's configuration directory (`~/.config/snagentic/trust.yaml`,
   or the OS equivalent). Before any request, the profile read from the workspace must match
   the trust record. When it doesn't, snagentic refuses with a hint to run
   `snagentic instance trust <name>`, which shows the difference and asks the person to
   confirm. Agents can't confirm it: the command is interactive-only and not exposed through
   MCP.
2. **Env and CI credentials are pinned to a host.** In env mode, `SNAGENTIC_<NAME>_URL` must
   be set and equal the profile URL. Otherwise the secret is not read.
3. **Probe every non-development credential, and the declared kind too.** Layer 4 already
   probes test and production. In addition, a profile that says `development` but whose
   credential holds `snc_read_only` is refused as inconsistent.

## Consequences

- Turning a production profile into a development one needs a person at a terminal, not just
  a commit.
- A clone on a new machine needs one `instance trust` per instance. That is one more step in
  `docs/getting-started.md`.
- CI needs one more variable per instance.
- The trust file is user state outside git. It is not synced, and that is intended.

## Alternatives considered

- **Sign `instance.yaml`.** It needs a key per user and gives the same guarantee as a local
  record, with more machinery.
- **Ask the instance for its kind (`glide.installation.production`).** That property isn't set
  reliably, and an attacker-controlled host would answer whatever it likes.
- **Rely on the agent hooks only.** Hooks are guidance (ADR-0011), and shell commands bypass
  them.
