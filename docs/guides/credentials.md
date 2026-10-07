# Credentials and instance trust

How snagentic stores instance passwords, why each one is bound to a single instance, and
what to do when it refuses one. Design decision:
[ADR-0020](../adr/0020-instance-trust-outside-the-repository.md).

## In short

- A password lives in the **OS keychain** on your machine, or in **environment variables**
  in CI. Never in the workspace, a log or an error message.
- The password is stored **together with the instance's URL and kind**. snagentic uses it
  only while `instances/<name>/instance.yaml` still says the same URL and kind.
- `snagentic auth login` checks the password and its roles **before** storing it.
- Coding agents can't run `snagentic auth` or set credential variables.

## Why the password is bound to the instance

`instance.yaml` is an ordinary file in the workspace. A coding agent, a script or a pull
request can change it. If the password were stored on its own, changing that file would be
enough to:

- **Make production writable.** Change `kind: production` to `kind: development`, and the
  write commands would appear for a production instance.
- **Send the password elsewhere.** Change `url` to another host, and the next command would
  send the stored password there.

Binding the password to the URL and kind it was stored for closes both. The trusted values
live outside the repository, where a change to the workspace can't reach them. Only a person
running `snagentic auth login`, or the CI configuration, can set them.

## On your machine

```sh
snagentic instance add dev --url dev12345 --username jdoe --kind development
snagentic auth login dev            # asks for the password, checks it, stores it
snagentic doctor --instance dev     # credentials, connection, roles, timestamps, load
```

`auth login` does three things before it stores anything:

1. **Signs in** with the password you typed. A wrong password is never stored.
2. **Checks the roles against the kind:**

   | Kind | The account must |
   |---|---|
   | `development` | **not** hold `snc_read_only`. That role marks a test or production credential, so holding it suggests the wrong kind. |
   | `test`, `production` | hold `snc_read_only` ([ADR-0012](../adr/0012-production-read-only-by-construction.md)). |

3. **Stores one keychain item** holding the password, the URL and the kind:
   - service `snagentic`;
   - account `<username>@<host>`, for example `jdoe@dev12345.service-now.com`.

The keychain is macOS Keychain, Windows Credential Manager or Linux Secret Service.
`snagentic auth logout <name>` deletes the item.

### When you need to log in again

| You changed | What happens | What to do |
|---|---|---|
| The `url` or `username` | The account name changes, so no password is found: `credentials-missing` | `snagentic auth login <name>` |
| The `kind` | The password is refused: `profile-not-trusted` | `snagentic auth login <name>` |
| You upgraded from 1.1.0 or earlier | The old item records no URL or kind, so it's refused: `profile-not-trusted` | `snagentic auth login <name>`, once per instance |

If you **didn't** make the change, don't log in again. Find out who did, and restore the
file:

```sh
git checkout -- instances/<name>/instance.yaml
```

## In CI and on servers

There's no keychain in CI, so the password comes from environment variables. Set **all
three**: the URL and kind take the place of the keychain binding.

| Variable | Value |
|---|---|
| `SNAGENTIC_<NAME>_PASSWORD` | The password |
| `SNAGENTIC_<NAME>_URL` | The instance URL, in any form `instance add` accepts: `acme`, `acme.service-now.com` or `https://acme.service-now.com` |
| `SNAGENTIC_<NAME>_KIND` | `development`, `test` or `production` |

`<NAME>` is the instance name in capitals, with `-` replaced by `_`: instance `acme-prod`
uses `SNAGENTIC_ACME_PROD_PASSWORD`.

A password variable without a valid URL and kind is refused. When the password variable is
set, it's used instead of the keychain.

GitHub Actions example:

```yaml
jobs:
  pull:
    runs-on: ubuntu-latest
    environment: production        # protected: required reviewers, branch rules
    env:
      SNAGENTIC_PROD_PASSWORD: ${{ secrets.SNAGENTIC_PROD_PASSWORD }}
      SNAGENTIC_PROD_URL: ${{ vars.SNAGENTIC_PROD_URL }}
      SNAGENTIC_PROD_KIND: production
```

Keep the URL and kind in the CI configuration, not in a file in the workspace. Otherwise a
pull request could change them together with `instance.yaml`.

## What agents can't do

The host hooks and permission rules installed by `snagentic agent install` refuse:

- any `snagentic auth` command;
- shell commands that set `SNAGENTIC_<NAME>_PASSWORD`, `_URL` or `_KIND`;
- edits to protected files, such as the git hooks and the host settings.

An agent can still edit `instance.yaml`. That's harmless: the change makes the password
unusable, and never sends it somewhere else.

## Troubleshooting

`snagentic doctor --instance <name>` reports the credential first. When it fails, the other
checks are skipped and no request is sent.

| Code | Meaning | What to do |
|---|---|---|
| `credentials-missing` | No password for `<username>@<host>` | `snagentic auth login <name>`; in CI, set the three variables |
| `profile-not-trusted` | `instance.yaml` doesn't match what the password was stored for. The message names the field and both values | If you made the change, log in again. If not, restore the file |
| `authentication-failed` | The instance rejected the username or password | Check both, then `snagentic auth login <name>` |
| `read-only-credential-required` | A test or production account doesn't hold `snc_read_only` | Ask the ServiceNow admin to grant the role, then check with `doctor` |
| `read-only-credential-on-development` | A development profile whose account holds `snc_read_only` | Check `kind` in `instance.yaml`. If it's right, use a development account |
| `keychain-unavailable` | The OS keychain couldn't store the password | Unlock or set up the keychain, or use the environment variables |

## What this protects against, and what it doesn't

It protects against:

- a change to `instance.yaml` making a test or production instance writable;
- a change to `instance.yaml` sending a stored password to another host;
- storing a mistyped password, or a credential whose roles don't match the kind;
- an agent running `auth` commands or injecting credential variables.

It doesn't protect against:

- **A compromised ServiceNow account.** Roles on the instance are the real boundary. Give
  test and production accounts `snc_read_only`, and nothing more.
- **A compromised machine or CI runner.** Whoever controls the keychain or the CI
  configuration controls the credentials. In CI, that configuration is the root of trust:
  protect it with environments, required reviewers and branch protection.
- **A person logging in again after a malicious change.** Read the `profile-not-trusted`
  message before running `auth login`: it names what changed.

See also: [security and governance](../product/security-and-governance.md) and
[getting started](../getting-started.md).
