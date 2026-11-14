# Onboard a new instance (PDI or any development instance)

From an empty folder to a pulled, integrated workspace, on macOS, Linux or Windows. These are the
manual steps; the helper scripts at the end do the same in one run for the ITSM accelerator.

## What you need

- snagentic installed ([getting started, section 1](../getting-started.md#1-install)) and `git`.
- The instance's name (`dev12345`), and a user with the `admin` role. On a PDI, that is `admin`
  and the password the developer site gives you. Use a named service account for anything shared.
- The instance awake. A PDI that has been idle sleeps; wake it at developer.servicenow.com
  (Manage > Instance) and wait until it opens in a browser.

## One command

```sh
snagentic onboard dev --url dev12345 --username admin
```

It is the same on macOS, Linux and Windows. It creates the workspace (in the folder you are in if it
is one, else `~/snagentic/dev`, or where `--path` says), adds the profile, asks for the password
without showing it and keeps it in the OS keychain, checks that the instance answers, runs
`doctor`, then `pull` and `integrate`. It stops at the first problem and says what to do:

| It says | What it means | What to do |
|---|---|---|
| `asleep` | A developer instance that has been idle hibernates | Wake it at developer.servicenow.com (Manage > Instance), wait until it opens in a browser, run the same command again |
| `unauthorized` | The instance refused the user | Check the password; on a Brazil-release instance, give the user `snc_basic_auth_api_access` (below) |
| `unreachable` | No answer, or it timed out | Check the address and your network ([network guide](network.md)) |
| `refused` | Another refusal, such as a user that isn't the one named | Its message and hint say what |
| `doctor failed` | A check failed | `snagentic doctor --instance dev` shows which |

Run it again with the same answers to continue: what is done is skipped, and the pull resumes. The
password is kept only once the instance has accepted it. For a test or production instance add
`--kind production --acknowledge-read-only`, with a credential that holds `snc_read_only`. Add
`--client-id` for an OAuth client ([credentials](credentials.md)). `onboard` is for people: it reads a
secret, so it is not an MCP tool and an agent can't run it for you.

Then, when you will work with a coding agent: `snagentic agent install`.

## The same steps by hand

Each step of `onboard` is also a command, which helps when you want to do one on its own.

macOS and Linux (bash, zsh):

```sh
snagentic init ~/snagentic/acme
cd ~/snagentic/acme
snagentic instance add dev --url dev12345 --username admin --kind development
snagentic auth login dev
```

Windows (PowerShell):

```powershell
snagentic init $HOME\snagentic\acme
Set-Location $HOME\snagentic\acme
snagentic instance add dev --url dev12345 --username admin --kind development
snagentic auth login dev
```

Both then continue the same way:

```sh
snagentic doctor --instance dev
snagentic pull dev
snagentic integrate dev
```

`auth login` asks for the password without showing it and stores it in the OS keychain (macOS
Keychain, Windows Credential Manager), bound to the instance's URL and kind. Nothing is written to
the workspace.

## Brazil-release instances answer 401 to REST

Instances on the Brazil release refuse REST Basic authentication unless the user holds the role
`snc_basic_auth_api_access`. `doctor` shows the 401. In the browser, as an admin, open
**User Administration > Users**, open the user, **Roles > Edit**, add `snc_basic_auth_api_access`,
save, and run `doctor` again.

## Check each step

| Step | Proves it worked |
|---|---|
| `doctor --instance dev` | connection, roles, timestamps and load are all ok |
| `pull dev` | finishes; the next `pull dev` costs about 22 requests |
| `integrate dev` | `status` says nothing is pending |
| `find incident` | the mirror answers in milliseconds |

## The accelerator team's scripts

For the accelerator team, two scripts in [`scripts/onboard/`](../../scripts/onboard) do the whole onboarding for the
ITSM accelerator: `snagentic onboard`'s steps, plus the pack pin, the pack's regression mark, retiring a profile
that an instance replaces, and the ITSM install with demo data.

| OS | Run | Needs |
|---|---|---|
| macOS, Linux | `scripts/onboard/onboard-pdi.sh` | bash, git, curl, python3 |
| Windows | `.\scripts\onboard\onboard-pdi.ps1` | PowerShell 5.1 or 7, git |

They expect the `ntt-accelerators` clone and the `spaces/` folder next to this repository (or in the folder
`ONBOARD_ROOT` names). Both ask for the instance, a profile name, the user and the password (never echoed or written to
disk), check the instance is awake and that REST accepts the user, create `spaces/<profile>-<instance>`, store the
password in the OS keychain, run `doctor`, the first pull and `integrate`, pin the pack in a detached worktree, and plan
the ITSM install. They install only after you read the plan and answer yes. Run again with the same answers to continue
after a failure. `--retire <profile>` (`-Retire <profile>` on Windows) forgets a profile's password and archives its
workspace; nothing on the instance is touched.

A test keeps the commands they call in step with the registry. The Windows script was written to match the bash one but
has not yet run on a Windows machine; report what fails.

Set `SNAGENTIC` to use another build (`$env:SNAGENTIC` in PowerShell). The default is `~/bin/snagentic`, or
`%LOCALAPPDATA%\snagentic\bin\snagentic.exe` on Windows.
