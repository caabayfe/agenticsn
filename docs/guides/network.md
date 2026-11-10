# Network: proxies and corporate certificates

How to run snagentic on a corporate network that sends traffic through a proxy or inspects TLS,
and how to see which settings are in effect.

## In short

- Set the proxy and the corporate certificate **in your own environment** (shell profile, CI job
  variables). snagentic reads them when it starts.
- `snagentic doctor` shows the proxy and the extra certificates in effect.
- Coding agents can't set these variables, and a committed MCP config that sets them for
  snagentic's server makes `doctor` fail.

## Supported setup

| Need | Set | Notes |
|---|---|---|
| Send traffic through a proxy | `HTTPS_PROXY` (or `https_proxy`) | For example `http://proxy.corp.example:8080`. `HTTP_PROXY` applies to plain `http://` addresses only; instances use HTTPS. |
| Reach some hosts directly | `NO_PROXY` (or `no_proxy`) | Comma-separated host names or domain suffixes, for example `localhost,.corp.example`. |
| Trust a TLS-inspecting proxy, or an instance behind a corporate CA | `NODE_EXTRA_CA_CERTS` | Path to a PEM file with the corporate root certificate(s). It is **added** to the built-in list, so public instances still work. |

```sh
export HTTPS_PROXY=http://proxy.corp.example:8080
export NO_PROXY=localhost,.corp.example
export NODE_EXTRA_CA_CERTS=/etc/corp/root-ca.pem
snagentic doctor
```

A proxy that needs a user name and password takes them in the address
(`http://user:password@proxy.corp.example:8080`). Prefer a proxy that authenticates the machine
instead: the address is visible to every process you start.

## What is not supported

- **The OS trust store.** snagentic checks certificates against its built-in list (the one
  Mozilla publishes) plus `NODE_EXTRA_CA_CERTS`. A root certificate installed only in the macOS
  Keychain or the Windows certificate store is not trusted: export it as PEM and point
  `NODE_EXTRA_CA_CERTS` at it.
- **Client certificates (mutual TLS).** An instance that requires a client certificate can't be
  reached.
- **Turning certificate checks off.** `NODE_TLS_REJECT_UNAUTHORIZED=0` has no effect on
  requests to an instance: snagentic always checks the certificate, so a credential is never sent
  to a server it can't verify.
- **Redirects.** A request answered with a redirect fails instead of following it, so a
  credential never reaches another address.

`SSL_CERT_FILE` (which replaces the built-in list), `SSL_CERT_DIR`, `NODE_USE_SYSTEM_CA` and
`ALL_PROXY` are reported by `doctor` when set, because they can change where traffic goes or what
is trusted; use the variables in the table instead.

## What doctor shows

`snagentic doctor` has a `network` line with the proxy variables and the certificate variables in
effect. Credentials in a proxy address are replaced with `***`:

```text
ok          network       HTTPS_PROXY=http://***@proxy.corp.example:8080, NO_PROXY=localhost,.corp.example; NODE_EXTRA_CA_CERTS=/etc/corp/root-ca.pem
```

With nothing set, it reads `direct connection; built-in certificate list`. If you see a proxy or
a certificate file you didn't set, find where it comes from before you log in to an instance:
whoever runs that proxy, or owns that certificate, can read the traffic, credentials included.

Inside a workspace, the `mcp-config` line checks `.mcp.json` and `.vscode/mcp.json`. These files
are committed and start snagentic's server for everyone who clones the workspace, so snagentic's
entry there must not set a proxy, certificate or runtime variable. `doctor` fails when it does;
remove the variable from the entry and set it in your own environment.

## Coding agents

The agent pack's shell hook refuses commands that set any of these variables, as it refuses
commands that turn off certificate checks or change the runtime. Your own environment still
applies to the agent's snagentic, so a proxy you set works for it too. The hook is guidance, not
the boundary ([ADR-0011](../adr/0011-enforcement-layers.md)): the certificate check
and the redirect refusal above are enforced by snagentic itself.

## CI

Set the same variables as job variables, next to the instance credentials. See
[credentials and instance trust](credentials.md) for the credential variables.
