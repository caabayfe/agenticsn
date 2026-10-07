# 0020. Instance kind and address are trusted from outside the repository

- Status: Accepted
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

## Decision

A secret is released only together with the settings a person stored it for.

1. **The keychain item binds the secret to the instance.** `snagentic auth login` stores, in
   one OS keychain item (service `snagentic`, account `<username>@<host>`), the secret and the
   profile's `url` and `kind`. Before any request, the profile read from the workspace must
   match the item:
   - a changed `url` finds no item, so the secret is never sent to another host;
   - a changed `kind` is refused, so layers 3 and 4 of ADR-0012 cannot be switched off by an
     edit;
   - an item stored by an earlier version (secret only) is refused until the person logs in
     again.
2. **Logging in is how a person trusts new settings.** It needs the password, which the agent
   does not have. Before storing anything, `auth login` makes one request with the typed
   password (wrong passwords store nothing) and checks the credential matches the kind:
   a test or production credential must hold `snc_read_only`, and a development credential
   must not. So a person who logs in after an agent changed `kind` is refused too. The
   pre-shell hook refuses `snagentic auth` from the agent's shell.
3. **Environment credentials are pinned too.** With `SNAGENTIC_<NAME>_PASSWORD`, the
   variables `SNAGENTIC_<NAME>_URL` and `SNAGENTIC_<NAME>_KIND` must also be set and match
   the profile. The environment is set by whoever runs the job, not by the repository.
4. `doctor --instance` applies the same check and never sends an untrusted secret.

## Consequences

- Turning a production profile into a development one needs a person with the password, and
  that person is refused too while the credential holds `snc_read_only`.
- Upgrading needs one `snagentic auth login <name>` per instance, because existing keychain
  items hold only the secret. CI needs two more variables per instance.
- `auth login` now needs the instance to be reachable.
- Write use cases may still be listed for an edited profile (layer 3 reads the profile), but
  they cannot obtain a secret, so they never reach the instance.

## Alternatives considered

- **Sign `instance.yaml`.** It needs a key per user and gives the same guarantee as a local
  record, with more machinery.
- **Ask the instance for its kind (`glide.installation.production`).** That property isn't set
  reliably, and an attacker-controlled host would answer whatever it likes.
- **A separate trust file in the user's configuration folder.** Any process running as the
  user, including the agent's shell, can edit a file. The keychain item is created by
  snagentic and needs the password to replace.
- **Rely on the agent hooks only.** Hooks are guidance (ADR-0011), and shell commands bypass
  them.
