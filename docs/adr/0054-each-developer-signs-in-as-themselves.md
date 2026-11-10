# 0054. Each developer signs in as themselves, whatever user the committed profile names

- Status: Accepted (2026-11-10)
- Date: 2026-11-10
- Requirements: G1, ASR-02, ASR-06, ASR-08
- Amends: 0004 (team mode: who signs in), 0020 (where the username comes from)
- Relates to: 0021 (OAuth client credentials), 0052 (the shared mirror)
- Evidence: spec 014, T2. Read on `main` 90f6293:
  - `instances/<name>/instance.yaml` holds one `auth.username`
    (`packages/core/src/instance/domain/profile.ts`), and nothing else supplies one: the
    environment gives only `_PASSWORD`, `_URL` and `_KIND`
    (`adapters/credentials/environment-credential-store.ts`);
  - the keychain account is `<username>@<host>` (`credentialAccount`), and `auth login` takes no
    username (`registry/auth-login.ts`);
  - every connection checks that the instance signed in that username (`verify-access.ts`,
    `identity-mismatch`);
  - `push` finds its update sets and the user's preferences by that username
    (`push-steps.ts`, `push-units.ts`);
  - `pull` records it as the user that pulled, and `--publish` compares it with the shared state
    (`pull-session.ts`, `registry/pull.ts`).

## Context

ADR-0004's team mode has each developer push "with the developer's own user (real authorship
in update sets)". ADR-0052 adds a designated puller: a CI service account that pulls each
instance and publishes the mirror.

Both need different users on the same instance profile. But the profile is a committed file
with one username, so every clone and the CI job sign in as the same user:

- **Developer B in a workspace whose `instance.yaml` names A.** `auth login` signs in as A. B's
  own password is refused (`authentication-failed`). B can only proceed with A's password, or
  by editing the committed file.
- **The puller and the developers.** If the file names the service account, every developer
  pushes as the service account, and update sets lose their authors. If it names a developer,
  the scheduled pull signs in as that developer.
- **Editing the file locally** works for one clone: the keychain item becomes
  `<B>@<host>`, and `auth login` stores B's password. But the change shows in every
  `git status`, merges conflict with changes to the file, and committing it by mistake moves
  the whole team, and the scheduled pull, to B.
- **ADR-0052 item 4 can't take effect as designed.** It protects the mirror from a user with
  narrower read access. With one username for everyone, every pull looks like the puller's.
  And any developer passes the publish check, so only branch protection stops them publishing.

## Decision

1. **The username has three sources, in this order:**
   1. the environment: `SNAGENTIC_<NAME>_USERNAME`, for CI and servers, set with the other
      credential variables;
   2. this clone's identity, stored by `auth login`, outside the repository;
   3. `auth.username` in `instance.yaml`: the team's default, normally the designated puller.

   One resolved username is used everywhere the profile's is used today: the keychain account,
   the identity check, push attribution, and the user a pull records.

2. **`auth login <name> --username <user>` sets this clone's identity.** It signs in as
   `<user>`, checks the roles as today, stores the secret under `<user>@<host>`, and records
   `<user>` as this clone's identity for the instance. Without `--username`, it uses the
   resolved username, as today.
   - The identity is stored in the OS keychain, next to the secret and bound in the same way
     (ADR-0020): one item per clone and instance, holding the username with the instance's url
     and kind. It is used only while they match. An agent's shell can't edit it, as it can't
     edit the secret.
   - `auth logout <name>` removes it. The clone then falls back to `instance.yaml`.

3. **Changing the identity can't release another secret.** The secret stays keyed by
   `<username>@<host>` and bound to the URL and kind. A changed identity finds no item, or an
   item that person stored for that instance. The agent can't run `auth` or set credential
   variables, so it can't change the identity either.

4. **Commands say who they act as.** `doctor`, `instance list` and the start of `pull` and
   `push` show the resolved username and where it came from (environment, this clone, or
   `instance.yaml`).

5. **The OAuth client is unchanged.** With client credentials (ADR-0021), the user is the
   client's OAuth Application User. A developer with their own client sets it with
   `auth login --client-id`, in the same way.

## Consequences

- Each developer pushes as themselves. Update sets show the real author, as ADR-0004 intends.
- The committed profile names the puller. The scheduled pull needs no new variable, and
  developers don't touch `instance.yaml`.
- ADR-0052 item 4 applies between real users: a developer's pull never removes records by
  absence, and only the puller's identity passes the publish check.
- Solo mode doesn't change: with no stored identity and no variable, the username comes from
  `instance.yaml`, and existing keychain items keep working.
- One more variable is accepted in CI (`_USERNAME`). It isn't secret, and it pins nothing: the
  URL and kind still pin the secret.
- The hooks' environment check covers the new variable, and the keychain keeps the identity out
  of the workspace.
- Owed with the build: tests for each source and their order, for login with `--username`, and for
  the publish check with two identities; the team-mode guide's "Who signs in" section.

## Alternatives considered

- **Keep one username, and tell developers to edit their copy of `instance.yaml`.** It works
  for one clone, but every `git status` shows it, and one mistaken commit moves the team and the
  scheduled pull to that developer. This was the stopgap the guide documented until this
  decision.
- **One instance profile per developer (`dev-jdoe`).** The mirror branch and its state are per
  instance name, so each developer would have their own mirror again. That undoes ADR-0052.
- **Leave `username` out of `instance.yaml`.** Every clone, and the CI job, would have to supply
  one before any command. That breaks existing workspaces and solo mode, for no gain over a
  fallback.
- **Take the username from the keychain item alone.** The keychain account is looked up by the
  username, so the username must be known first. Item 2 stores the identity in a second item,
  looked up by the clone and the instance.
- **Store the identity in a file under `.snagentic/<name>/`**, protected by the agent hooks. It is
  outside git, but inside the workspace, where an agent's shell can write it, and the hooks are
  guidance, not a boundary (ADR-0011). The keychain keeps it with the secret, out of the agent's
  reach (decided by the product owner, 2026-11-10).
- **`git update-index --skip-worktree` on `instance.yaml`.** It hides the local edit, but git
  then refuses merges that change the file, and the setting is invisible and easy to forget.
