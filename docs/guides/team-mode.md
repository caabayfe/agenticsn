# Team mode: one pull per instance

How a team shares one mirror of each instance through git, so the instance is pulled once, not
once per developer. Design decisions: [ADR-0004](../adr/0004-deployment-topology.md) (team mode)
and [ADR-0052](../adr/0052-the-mirror-carries-its-pull-state.md) (the shared mirror).

## In short

- **One designated puller per instance.** A scheduled CI job, signed in as a service account,
  pulls the instance and publishes `servicenow-remote/<name>` to the team's git remote.
- **Everyone else gets the mirror through git.** `integrate` and `status` fetch it. A
  developer's own `pull` asks the instance nothing while the mirror is younger than its max
  age (15 minutes by default).
- **Only the puller can push the mirror branch.** Protect `servicenow-remote/*` on the git host.
- **The mirror shows the instance as the puller sees it.** Give that account read access to
  everything the team works on.

## How it works

Each mirror commit carries the state it was pulled with, in `instances/<name>/pull/`: the
watermark, fingerprints and catalog. So any clone, or a CI runner that starts empty, continues
from the commit it fetched. It never needs a full pull of its own.

A pull with a shared mirror:

1. fetches `servicenow-remote/<name>` from the remote;
2. continues from whichever of the local and the shared branch was pulled later;
3. asks the instance nothing if that mirror is younger than `max_age_minutes`.

`pull --publish` then pushes the result, fast-forward only. Two publishers can't split the
branch's history: a refused push fetches, continues from the newer commit and tries once more.

## Set up

### 1. Name the shared mirror

In the workspace repository, add the instance with the remote that holds the team's mirror,
and commit `instance.yaml`:

```sh
snagentic instance add dev --url dev12345 --username svc_snagentic --kind development \
  --shared-mirror origin
git add instances/dev/instance.yaml && git commit -m "add dev"
```

Or add it to an existing `instances/dev/instance.yaml`:

```yaml
shared_mirror:
  remote: origin
  max_age_minutes: 15   # a pull asks the instance nothing while the mirror is younger
```

`--username` names the puller's service account. See [who signs in](#who-signs-in) for what
this means for developers today.

### 2. Give the puller read access

The puller's account decides what the mirror holds. A record it can't read isn't in the
mirror, for anyone. Give it:

- read access to every table and application the team works on, including the dictionary
  (`sys_dictionary`, `sys_db_object`), so `describe` and `adopt` see the whole catalog;
- read access to the change feed (`sys_metadata`, `sys_update_xml`), so incremental pulls find
  every change;
- on test and production, `snc_read_only` and no write roles
  ([ADR-0012](../adr/0012-production-read-only-by-construction.md)).

Why it matters: a pull by the account that wrote the mirror removes records it no longer sees.
A pull by any other account adds and changes records, but never removes one just because its
own listing left it out (ADR-0052, item 4). So the mirror follows the puller's access, and a
developer with narrower access can't delete records from it.

### 3. Add the scheduled pull

Copy the template
[`packaging/ci/github/snagentic-pull.yml`](../../packaging/ci/github/snagentic-pull.yml) to
`.github/workflows/snagentic-pull-dev.yml`. Use the copy from the release you install, so its
commands match the binary. Replace `dev` and `DEV` with your instance name.

Then set, in the repository's settings:

| Setting | Kind | Value |
|---|---|---|
| `SNAGENTIC_DEV_PASSWORD` | secret | The puller's password, or its OAuth client secret |
| `SNAGENTIC_DEV_URL` | variable | The instance URL, for example `dev12345.service-now.com` |
| `SNAGENTIC_MIRROR_DEPLOY_KEY` | secret, optional | The private half of a deploy key with write access (step 4) |

`SNAGENTIC_DEV_KIND` is set in the workflow itself. It must match `kind` in `instance.yaml`.
The URL and kind stay in the CI configuration, so a pull request can't change them together
with `instance.yaml` ([credentials](credentials.md#in-ci-and-on-servers)).

The template:

- runs every 15 minutes, the default max age, and on demand;
- runs one pull of the instance at a time (`concurrency`), and never cancels one halfway;
- grants no permissions by default, and `contents: write` only to the job that publishes;
- pins every action by commit SHA;
- installs a pinned snagentic version, and fails unless the install script verified its build
  provenance ([ADR-0043](../adr/0043-upgrade-and-installers-verify-build-provenance.md));
- runs `snagentic pull dev --now --publish`. `--now` makes the scheduled pull always ask the
  instance, even when the last one is a little younger than the max age.

Raise `SNAGENTIC_VERSION` on purpose, after reading the changelog. Use the same version on the
developers' machines.

### 4. Protect the mirror branch

Anyone who can push `servicenow-remote/*` can change what the whole team sees as the instance.
So only the puller may push it:

1. Create a deploy key for the repository with write access. Store its private half as the
   `SNAGENTIC_MIRROR_DEPLOY_KEY` secret. The template's checkout uses it.
2. Add a branch ruleset for `servicenow-remote/*` that restricts creations, updates and
   deletions, and blocks force pushes.
3. Allow only that deploy key to bypass the ruleset.

Without a deploy key, the template pushes with the workflow's own token. Then any workflow in
the repository with `contents: write` can push the mirror too. Protect the workflow files with
required reviews.

snagentic checks what it can: it refuses a watermark later than the instance's clock, and a
publish by an account other than the one that wrote the mirror. It can't detect a watermark
someone moved back by hand. Branch protection is what stops that.

## Daily developer flow

Each developer clones the workspace repository and signs in once:

```sh
snagentic auth login dev     # see "Who signs in" below
```

Then:

```sh
snagentic status             # the shared mirror's age, and whether it holds pulls you lack
snagentic integrate dev      # fetches the shared mirror, then merges it into your branch
snagentic pull dev           # only when status suggests it: the mirror is older than max age
```

- `status` suggests `integrate` when the shared mirror is ahead of your branch, and `pull` only
  when the mirror is older than its max age.
- A `pull` inside the max age sends no request to the instance. `--now` pulls anyway.
- Never use `--publish` on your own machine. Publishing is the scheduled job's work.
- `pull`, `integrate` and `status` call the git remote with your own git credentials. Instance
  secrets never reach git.

Your agent's skills follow `status`. An agent doesn't offer a pull just because your clone
never pulled.

## Who signs in

ADR-0004 asks each developer to push with their own instance user, so update sets show who made
each change. Today that doesn't work cleanly, because the user comes from the committed
`instance.yaml`:

- `instance.yaml` holds one `username`. Every clone signs in as that user.
- The keychain item is named `<username>@<host>`. `auth login` signs in as that username, so a
  developer's own password is refused (`authentication-failed`).
- Pushes are attributed to that username, and look for its update sets.

So, until [ADR-0054](../adr/0054-each-developer-signs-in-as-themselves.md) is decided and built:

- Name the puller's service account in `instance.yaml`. That is what the scheduled pull needs.
- A developer who pushes as themselves changes `username` in their clone only, and logs in
  again. Don't commit that change: the scheduled pull would then sign in as that developer,
  with the puller's password, and fail. Pulls from such a clone count as another user's: they
  add and change records, and never remove one by absence.
- A clone that only reads (status, integrate, describe, search) doesn't need an instance
  login at all.

## Troubleshooting

| Code | Meaning | What to do |
|---|---|---|
| `publish-rejected` | The remote refused the mirror branch twice: another pull published in between | Run the pull again. Pushes are fast-forward only, so nothing was lost. If it repeats, check that only one job pulls this instance |
| `publish-refused` | The shared mirror was written by another instance user | Publish only from the scheduled job, signed in as the puller. On your machine, pull without `--publish` |
| `publish-needs-shared-mirror` | `--publish` on a profile without `shared_mirror` | Add `shared_mirror` to `instance.yaml`, or pull without `--publish` |
| `mirror-moved` | Another pull moved the mirror branch while this one ran. Nothing was committed | Run the pull again: it continues from what the other pull left |
| `watermark-in-future` | The mirror's state says it was pulled later than the instance's clock. A pull didn't write that state | Run `snagentic pull <name> --full` from the puller, and check who can push `servicenow-remote/<name>` |
| `workspace-locked` | Another command is changing the instance in this workspace | Wait for it to finish. If it's no longer running, remove `.snagentic/<name>/workspace.lock` |
| `git-command-failed` | A git fetch or push failed | Check your git credentials for the remote, and that the remote named in `shared_mirror` exists (`git remote -v`) |

See also: [getting started](../getting-started.md#team-mode-one-pull-per-instance),
[credentials and instance trust](credentials.md).
