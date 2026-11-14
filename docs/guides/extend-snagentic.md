# Extending snagentic: a use case, a rule, a skill

For contributors. Read [AGENTS.md](../../AGENTS.md) first: the layers, the safety invariants and
the test-first rule apply to everything below. Every change serves a goal, an ASR or an ADR; if
none fits, stop and ask. Anything outside [ADR-0010](../adr/0010-v1-scope.md) and the ADRs that
amend it needs a new ADR first.

Each example is real code you can read; copy the shape, not the content.

## Add a use case

A use case is the one definition of an operation. The CLI command, the MCP tool, the JSON output
and `docs/reference/commands.md` are generated from it (ADR-0003). You never write a command or
tool by hand.

Worked example: [`plugins-list.ts`](../../packages/cli/src/registry/plugins-list.ts), a small
read-only use case. Its parts, in order:

1. **Failing test first.** Put it in `packages/core/test/<context>/` for the logic and
   `packages/cli/test/registry/` for the use case, using the in-memory fakes in
   `packages/core/test/support/` and `packages/cli/test/support/fakes.ts`.
2. **Application service** in the context that owns the behavior
   (`packages/core/src/<context>/application/`), reaching the outside only through the
   context's `ports.ts`. No I/O in `domain/`. A new port needs an adapter in
   `packages/cli/src/adapters/` and its contract test.
3. **The use case** in `packages/cli/src/registry/<name>.ts`:

   ```ts
   export const pluginsList = defineUseCase({
     group: "plugins",            // the command: snagentic plugins list
     name: "list",
     description: "...",          // becomes the help text and the MCP tool description
     input: z.object({ instance: z.string(), text: z.string().optional() }),
     output: z.object({ /* ... */ }),
     flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
     mcp: true,                   // only if it earns one of the 13 MCP tools (ADR-0002, ADR-0026)
     mcpName: "plugins",
     arguments: ["instance", "text"],   // positional CLI arguments
     async handle(input, context) { /* call one application service */ },
     render(output) { /* the text a person reads */ },
     exitCode: () => 0,
   });
   ```

   Keep `handle` thin: parse, call one service, shape the output. Business rules belong in the
   context.
4. **Register it** in `packages/cli/src/registry/registry.ts` (import it and add it to the list).
5. **Flags matter.** A use case that changes an instance sets `readOnly: false` and
   `requiresDevelopmentInstance: true`; for test and production it is then not registered at all
   (ADR-0012). Never add a "read" that writes.
6. **Regenerate the reference** with `bun run docs`; a test fails when `commands.md` is stale.
   Add the user-facing explanation to [getting started](../getting-started.md) if people need
   it, and a `[Unreleased]` entry to the changelog.
7. `bun run verify`, then commit with `feat(<context>): ...`.

Most use cases are CLI-only. The MCP budget (13 tools) is full: a new tool means retiring one or
a new ADR.

## Add a rule

Rules check what a change **introduces**. Worked example: SN-MNT-001, no hardcoded sys_ids. A
rule lives in three places, so the catalogue, the checker and the tests can't drift:

1. **Metadata** in `packages/core/src/advice/domain/rules.ts`, or in the `*-rules.ts` file beside it
   for ACL, accelerator, Fluent and documentation rules (each is spread into `RULES`). Take the next free number in its
   category; never reuse or renumber an ID.

   ```ts
   {
     id: "SN-MNT-001",
     category: "manageability",
     severity: "warn",            // "block" stops a push
     title: "No hardcoded sys_ids",
     why: "sys_ids differ across instances for data records and make intent unreadable.",
     remediation: "Use a system property, a lookup by a stable key, or a reference field.",
     scripts: ANY,                // which script classes it applies to
   },
   ```
2. **Implementation** in `packages/rules-basic/src/rules/<category>.ts`, keyed by the same ID,
   using the ESLint rule API and the helpers in `packages/rules-basic/src/ast.ts`
   (`recordOf`, `report`, `stringValue`, ...). See `SN-MNT-001` and `SN-MNT-008` there.
3. **Spec test**: add a row to `CASES` in `packages/rules-basic/test/rules.test.ts`:

   ```ts
   // [rule, record settings, triggering sample, passing sample]
   ["SN-MNT-001", {}, "gr.get('6816f79cc0a8016401c5a33be04be441');", "gr.get(gs.getProperty('x.id'));"],
   ```

   At least one triggering and one passing sample. Write it first and watch it fail.
4. If the rule belongs in a design or review recommendation, name it in the guidance table
   (`packages/core/src/advice/domain/guidance.ts`).
5. The README, getting started and the overview quote the number of rules; a test
   (`tests/tooling/product-docs.test.ts`) checks the quote against the code, so update the
   number in those files in the same commit.

Calibrate before you ship it: a rule that fires on out-of-box scripts is noise (the baseline is in
`docs/reports/`).

## Add or change a skill

Skills are guidance, never enforcement (ADR-0011): anything that must hold is enforced in code.
Each skill is one file in `packages/agent-packs/src/skills/` (see `build.ts`): `name`,
`description`, `when`, numbered `steps`, `decide` branches, `output`, `stopAndAsk` and `never`.
They are rendered per host by the pack. Refer only to tools and commands that exist (the pack's
contract test checks), keep each step to one action, and re-run the agent evaluations
(`bun scripts/eval/run.ts`, real cost) when you change behavior.

## Make the rules check another script class

Add the class's script fields, and where each runs (`server`, `client` or `portal_client`), to
`SCRIPT_FIELDS` in `packages/core/src/advice/domain/script-fields.ts`. A field missing there is
not checked, because guessing a client script is server code would report rules that cannot
apply. Add a test sample for the class; no per-class special cases elsewhere.

## Before every commit

```sh
bun run verify    # typecheck, lint, arch, size, tests
```

It must pass, and you must not weaken a test, a boundary rule or a budget to make it pass. One
logical change per commit, with a conventional prefix.
