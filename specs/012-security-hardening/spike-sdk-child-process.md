# Spike: the Fluent SDK in a child process

- Date: 2026-10-23
- Plan: `plan.md`, step 7 (the ADR after the quick fixes, merged in #145)
- Question: what does it cost to run the SDK's build and transform in a separate process that
  holds no credential, and can that process also be kept off the network and the disk outside
  the project?
- Machine: macOS (Apple silicon), Bun 1.4.3, SDK 4.13.6, fixture `tests/fixtures/fluent/server-modules`.
  Spike code was throwaway (a worker script and a parent script, IPC through `Bun.spawn({ ipc })`);
  it is not in the repository.

## Why

#145 refuses the routes we found by which a project makes the SDK run its code or touch files
outside it. It is a list of what SDK 4.13.6 does. The SDK runs inside snagentic, beside the
instance credential and the `fetch` that signs requests, so a route we missed, or one a later SDK
adds, reaches both.

## Results

### 1. Cost

| How the build runs | Time |
|---|---|
| In-process, as today: a fresh `bun` process loading the SDK and building once | 930–1,170 ms (whole command 0.96–1.03 s) |
| A new child per build (start, load the SDK, build, answer) | 984–1,003 ms |
| One long-lived child, later builds | 280–315 ms round trip (in-process: 267–295 ms) |
| Release binary start (`dist/snagentic --version`) | 20 ms |
| Compiled binary starting itself as a worker and answering over IPC | 8–10 ms |

Every snagentic command is already a fresh process that loads the SDK, so a child per build adds
roughly the start of a second process: tens of milliseconds against a build of about a second. A
long-lived child is not needed.

### 2. Transform works with the credential left in the parent

The SDK's instance requests already go through one function, `InstanceExchange`
(`scheduler-connector.ts`). In the child, that function sends the request to the parent over IPC
and waits for the answer; the parent sends it through the instance client, as today. The pdi2
recording's script include converted in the child in 323 ms, with its one request answered by
the parent. The child needs the host name, and never a credential.

### 3. `childEnvironment()` is not enough for this child

`childEnvironment()` removes snagentic's instance credential variables and keeps everything else,
because git and gh need their sign-ins. The child kept `CLAUDE_CODE_MESSAGING_TOKEN`; it would keep
`GITHUB_TOKEN`, cloud credentials and the rest. The SDK needs none of them. The SDK child should get
a short allow-list (`PATH`, `HOME`, `TMPDIR` pointing at its scratch folder, locale, `NO_TELEMETRY`),
not the parent's environment minus credentials.

### 4. Without an OS sandbox, the child reaches the network

A plain child fetched from a server the parent opened on 127.0.0.1. Removing the credential
removes what a planted module could steal from snagentic; it doesn't stop the module from
sending what it can read (the project, other files the user can read) anywhere.

### 5. macOS: `sandbox-exec` contains the child, and the build still works

With the profile
`(allow default)(deny network*)(deny file-write* (require-not (subpath <scratch folder>) …))`
the child built the fixture (7 records, 990 ms, no slower), and in the same process a write to
the home folder and a connection to 127.0.0.1 were both refused with EPERM. That is the
containment step 7 wants: no credential, no network, writes only in the build copy. Reads are not
limited by this profile.

`sandbox-exec` is marked deprecated by Apple but ships in current macOS; Bazel
and Claude Code use it for their sandboxes. If it is missing or refuses, snagentic would fall back to the plain child.

### 6. Not tested: Linux and Windows

- **Linux:** the candidates are `bwrap` or `unshare --net` (unprivileged user namespaces). Several
  distributions and most CI containers restrict user namespaces, so it must be optional there,
  with the plain child as the fallback. Docker was not running here; not tried.
- **Windows:** no comparable tool without extra installs (AppContainer needs native code, which
  ADR-0005 limits). The plain child only.

### 7. The SDK's own code loading (for the cheaper alternative)

A scan of the SDK packages for `import()` and `require()` with a computed specifier found, in the
paths `build` and `transform` use, only the Prettier config loader (`sdk-build-core`,
`prettier/config-loader.js`, refused by #145) and the SDK's own bundled plugins, loaded from its
install folder, not the project. The rest are in commands snagentic doesn't call (`init` hooks,
UI builds, `dependencies`, the LSP and web bundles). Direct `fs` use in the build path: only the
`dependencies` fetch, also not called. A test that pins this list would catch an SDK upgrade
adding a new code-loading route, as a review prompt; it would not contain one.

## Conclusion

The child process is cheap (tens of milliseconds per command) and fits the existing seams:
the runtime loader for build, `InstanceExchange` for transform. It gives three levels of
protection:

1. Everywhere: no credential and no unrelated tokens in the process that runs project-reachable
   code (allow-listed environment, not `childEnvironment()`).
2. macOS: no network and no writes outside the build copy (`sandbox-exec`), verified here.
3. Linux, where user namespaces are allowed: the same through `bwrap` or `unshare`, unverified.

Windows gets level 1 only. The ADR should promise "no credential" everywhere and the sandbox
only where it applies, and keep the guard test from section 7 as the review prompt for SDK
upgrades.
