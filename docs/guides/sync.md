# Sync an instance: pull, integrate, keep it fresh

How the instance's metadata gets into your workspace and stays current. Setup is in
[getting started](../getting-started.md) (sections 2 to 4); this guide is the routine, and what to do
when it doesn't go as planned.

## The model in one picture

```text
instance ──pull──▶ servicenow-remote/<name> branch ──integrate──▶ your working branch
 (read only)        (a commit per pull; never edit)               (the mirror under instances/<name>/)
```

- **pull** reads the instance and commits what it found to the branch `servicenow-remote/<name>`,
  with plumbing, so your working tree and index are never touched.
- **integrate** merges that branch into the branch you are on. The mirror is read-only: where
  the two disagree, the instance's copy wins and a local edit is discarded and named.
- **status** says what to do next. It never calls the instance.

Nothing in the mirror is yours to edit. Changes go into Fluent source under `source/`
([build a capability](build-a-capability.md)).

## First sync

```sh
snagentic doctor --instance dev     # credentials, connection, roles, timestamps
snagentic pull dev                  # complete and resumable
snagentic integrate dev
snagentic status                    # should say there is nothing left to do
```

On a PDI, expect about 30 minutes for 463,000 records. If the run stops (network, laptop
sleep, `Ctrl-C`), run the same command: it resumes. A very large instance may stop at its
request budget (20,000 requests by default); run it again and it continues. For an instance too
big for one scheduled job, make the first pull from a workstation with `pull --publish`
([team mode](team-mode.md)).

## The routine

| When | Run | Cost |
|---|---|---|
| Before you design or edit anything | `snagentic status`, then what its `next` says | none |
| Someone changed the instance, or you activated a plugin or installed an application | `pull dev`, `integrate dev` | with no changes, about 22 small requests and a few seconds |
| Every few days, or whenever the mirror looks wrong | `pull dev --verify` | compares counts with the instance and repairs what differs |
| After an upgrade, or you suspect missing records | `pull dev --full` | everything again |
| You want to know what a run cost the server (development only) | `pull dev --cost` | one extra, expensive read |

After `integrate`, if records you had adopted changed on the instance (drift), it says so. Refresh
your source before planning:

```sh
snagentic adopt --instance dev --refresh <record>
```

## A team: one pull per instance

Don't let every developer pull. One scheduled job pulls and publishes; everyone else gets the
mirror through git:

```sh
snagentic instance add dev --url dev12345 --username svc_ci --shared-mirror origin   # once, committed
snagentic pull dev --publish        # the job, signed in as the service account
snagentic integrate dev             # developers: fetches the shared mirror, then merges it
```

The full setup, with the GitHub Actions template, branch protection and the read access the
service account needs, is in [team mode](team-mode.md).

## Instance load

Every command in a process shares one request queue per instance: at most 4 requests at once and
10 per second on development, 2 and 5 on test and production. An instance owner can lower these in
the committed `instance.yaml` (`load:`), and whoever runs the machine can lower them with
`SNAGENTIC_<NAME>_MAX_CONCURRENCY` and `SNAGENTIC_<NAME>_REQUESTS_PER_SECOND`; see
[getting started, section 4](../getting-started.md#4-pull-then-integrate). Never work around the
queue with your own REST calls.

## Read-only instances

Pull works the same against test and production. Add them with `--kind test` or
`--kind production --acknowledge-read-only`, using a credential that holds `snc_read_only`;
snagentic checks before every connection and refuses otherwise.

## When something goes wrong

| Symptom | Cause and fix |
|---|---|
| `pull` is slow on a quiet instance | It should cost about 22 requests. Run `doctor --instance dev` for the proxy, the certificates and the timestamps in effect. |
| `pull` stops with "budget" | The run reached its request budget. Run it again; a full pull resumes where it stopped. |
| `pull` reports it was interrupted | Run it again. `status` shows the interrupted pull. |
| 401 on a Brazil-release instance | The user needs `snc_basic_auth_api_access`; see [onboarding](onboarding.md). |
| `integrate` says a local edit was discarded | You edited the mirror. Move the change to Fluent source. |
| A record is missing that the instance has | Is it readable by the account that pulled? A record a user can't read isn't in their listing. `pull --verify` shows counts. |
| Windows checkout shows CRLF in scripts | `doctor` reports `mirror-line-endings`; the [team-mode guide](team-mode.md#line-endings) has the one-time fix. |
| Behind a proxy | [Network guide](network.md): `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`. |
