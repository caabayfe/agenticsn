# The live tests and their nightly run

For contributors and the repository's owner. The default tests (`bun test`) never touch a
ServiceNow instance. The tests in `tests/live/` do: they check that a real instance still
answers the way snagentic expects. A scheduled workflow, `.github/workflows/live.yml`, runs
them every night against a developer instance (PDI) kept for this
([spec 016](../../specs/016-team-readiness/plan.md), step T1).

## What runs

`bun test tests/live` runs three files. The folders `tests/live/p1` and `tests/live/verify` hold
scripts run by hand; the nightly run doesn't use them, except the connection helper.

| File | What it checks | Writes to the instance |
|---|---|---|
| `fluent-endpoints.test.ts` | The ServiceNow IDE endpoints that delivery calls still answer as expected | No. Three calls the instance refuses or answers empty |
| `fluent-round-trip.test.ts` | Adopt, create, update, drift and refresh, delete, through the CLI in a new workspace | Yes, see below |
| `domains.test.ts` | Listing a record of another domain | No. Skipped unless `SNAGENTIC_LIVE_OTHER_DOMAIN_RECORD` is set |

The round trip:

- creates the system property `x_2222332_s11.live_round_trip_<timestamp>`, changes it three
  times (once through the Table API, as "someone else"), and deletes it;
- makes four pushes. Each one writes to the update set batch of the workspace's branch
  (`snagentic: <branch>`), which stays on the instance, and switches the user's current
  application and update set;
- leaves the property behind when it fails halfway. Delete it by hand, or leave it: the next
  run uses a new name.

It has a limit of 10 minutes. The other tests take seconds.

## What the instance needs

- A **development** instance. The tests refuse any other kind.
- A user that may deliver: `admin` on a PDI. On an instance of the Brazil release the user also
  needs the role `snc_basic_auth_api_access`
  ([credentials](credentials.md#in-ci-and-on-servers)).
- The application **`x_2222332_s11`** with its script include
  `123833b4d97d48be8e9ec5ea16f27764` (`E2EUtil`). The round trip adopts that record and creates
  its property in that application. They exist on the instance the test was written against;
  an instance without them fails the round trip at its first step.
- Nobody else delivering with the same user while the tests run: two writers overwrite each
  other's current update set.

## Set up the nightly run (once, in GitHub)

The workflow reads everything from one GitHub environment. Nothing below is a repository-level
secret.

1. **Settings > Environments > New environment**, named `live-pdi`.
2. Under **Deployment branches and tags**, choose *Selected branches and tags* and add `main`.
   This is what keeps the credential away from a workflow edited on another branch. Don't add
   *Required reviewers*: a scheduled run would wait for an approval every night.
3. Add to the environment:

   | Name | Kind | Value |
   |---|---|---|
   | `SNAGENTIC_PDI_PASSWORD` | secret | The user's password |
   | `SNAGENTIC_PDI_URL` | variable | The instance, for example `dev12345.service-now.com` |
   | `SNAGENTIC_PDI_USERNAME` | variable | The user, for example `admin` |
   | `SNAGENTIC_LIVE_OTHER_DOMAIN_RECORD` | variable, optional | `<class>:<sys_id>` of a record outside the user's domain. Without it the domain tests are skipped |

The kind, `development`, is written in the workflow. In the run's workspace the instance is
named `pdi`, which is where the variable names come from.

To try it, run the workflow by hand: **Actions > live > Run workflow**, on `main`.

## How a run ends

| Result | Meaning | What to do |
|---|---|---|
| Green, summary "Live tests passed" | The tests ran and passed | Nothing |
| Green, notice "Live run not configured, nothing tested" | The environment lacks a setting; the notice names it | Create it (above) |
| Green, notice "Instance asleep, nothing tested" | The instance hibernates, or didn't answer | Wake it in the developer portal; the next run tests again |
| Red, and an issue "Nightly live run failed" | The instance refused the sign-in, a test failed, or no test ran | Read the run the issue links to |

The workflow keeps one open issue: a later failed run adds a comment to it. Close it when a
run passes. It uses only the workflow's own token, with `issues: write`.

A green run isn't proof that the tests ran: read the notice or the summary. GitHub has no
neutral result for a workflow, and a sleeping PDI must not open an issue every night.

The workflow never runs for a pull request or in a fork. Its job runs only in
`caabayfe/agenticsn` on `main`, one run at a time. Only the two steps that call the instance
receive the password.

## When the PDI is reclaimed

ServiceNow reclaims a developer instance that nobody uses for some days. The run then reports
"Instance asleep, nothing tested" every night, or fails if the address answers something else.

1. Request a new instance in the developer portal.
2. Create the user, or reset the `admin` password, and grant the role above if needed.
3. Install the application `x_2222332_s11` with its script include, as on the previous
   instance.
4. Update `SNAGENTIC_PDI_URL`, `SNAGENTIC_PDI_USERNAME` and `SNAGENTIC_PDI_PASSWORD` in the
   environment.
5. Run the workflow by hand.

## Run the same thing on your machine

From a clone of this repository, with a workspace that has the instance and its stored
password (`snagentic instance add`, `snagentic auth login`):

```sh
SNAGENTIC_LIVE_INSTANCE=pdi SNAGENTIC_LIVE_WORKSPACE=../spaces/pdi bun test tests/live
```

`SNAGENTIC_LIVE_INSTANCE` is the instance's name in that workspace. The round trip copies its
`instance.yaml` into a new temporary workspace and works there; your workspace isn't changed.

To run exactly what the workflow runs, without a workspace or a keychain:

```sh
export SNAGENTIC_PDI_URL=dev12345.service-now.com SNAGENTIC_PDI_USERNAME=admin
export SNAGENTIC_PDI_KIND=development
read -rs SNAGENTIC_PDI_PASSWORD && export SNAGENTIC_PDI_PASSWORD
bun scripts/check-live-instance.ts /tmp/live-workspace     # a folder that doesn't exist yet
SNAGENTIC_LIVE_INSTANCE=pdi SNAGENTIC_LIVE_WORKSPACE=/tmp/live-workspace \
  bun test tests/live --timeout 60000
```
