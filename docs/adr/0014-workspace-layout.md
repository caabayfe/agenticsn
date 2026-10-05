# 0014. Synced data lives in a workspace with a standard layout

- Status: Accepted (amended by 0017)
- Date: 2026-10-05
- Requirements: ASR-01, ASR-06, ASR-08, ASR-13
- Amends: 0007 (paths become relative to a workspace root)

## Context

Synced instance data must live outside the snagentic source repository, and its
structure must not depend on how each user organizes folders. v1 kept data and tool
together (`instances/` in the tool's repository) and assumed paths relative to wherever
the command ran.

## Decision

- **A workspace is a dedicated git repository** that snagentic creates and owns:

  ```
  <workspace>/
    snagentic.yaml        manifest: layout version, instances, defaults
    .gitignore            generated; ignores .snagentic/ and secret-like files
    instances/<name>/
      instance.yaml       non-secret profile: url, kind, auth method, sync settings
      metadata/…          record directories (ADR-0007)
      update-sets/…
      operational/…       plugins, store applications, domains
    .snagentic/           local only: sync state, index, locks, caches
  ```

- **`snagentic init [path]`** creates it. The suggested default is
  `~/snagentic/<name>`. It:
  - initializes git and tunes it for large repositories (`feature.manyFiles`, untracked
    cache, file-system monitor where available);
  - writes the manifest and `.gitignore`;
  - **refuses to create a workspace inside another git repository**, including the
    snagentic source repository.
- **Workspace discovery.** Every command walks up from the current directory to the
  nearest `snagentic.yaml`, like git finds `.git`, unless `--workspace <path>` or
  `SNAGENTIC_WORKSPACE` is given. All data paths are relative to the workspace root; users
  never pass data paths.
- **One workspace per ServiceNow estate** (the dev, test and production instances of one
  organization). Each instance's remote state is the branch
  `servicenow-remote/<name>`, so drift between instances is a git diff.
- **The layout is versioned** (`layout: 1` in the manifest). A command that finds an
  unknown or older layout stops with a hint to run `snagentic migrate`; layouts are
  never changed silently.

## Consequences

- The snagentic source repository ignores `instances/` and `snagentic.yaml`, as a guard
  against accidentally committing instance data to it.
- A `workspace` context joins `packages/core` (manifest and layout rules in the domain,
  `init` and discovery in the application layer).
- Importing an existing v1 mirror becomes `snagentic migrate` from layout "v1". Reading
  the v1 format is already proven by spike S2.
