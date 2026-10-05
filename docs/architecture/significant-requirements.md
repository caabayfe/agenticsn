# Architecturally significant requirements

These requirements shape the architecture. Each ADR in [`../adr/`](../adr/) cites the
requirements it satisfies. A change that weakens one of them needs a new or superseding ADR.

Targets marked *(initial)* are starting values to validate with measurements, not proven
limits.

## Product goals

| ID | Goal |
|---|---|
| G1 | Develop on ServiceNow with any agentic tool (Claude Code, Codex, Copilot, Cursor, VS Code, ...), supported by git, instead of the browser or the Build Agent. |
| G2 | Use the instance information on disk for audit and troubleshooting. |
| G3 | Give agents guardrails for ServiceNow best practices, and validate a capability (local change or update set) for architecture, performance and security. |

## Requirements

| ID | Quality | Requirement | Measure |
|---|---|---|---|
| ASR-01 | Agent neutrality | Every capability works for an agent that can only read files and run shell commands. MCP, skills and host hooks are improvements, not prerequisites. | The full dev loop runs with files + CLI + `AGENTS.md` only. |
| ASR-02 | Write safety | Only instances of kind `development` can be written. A push requires a plan id, a passing gate and an unchanged remote base (optimistic concurrency). | No code path writes to test or production; tested. |
| ASR-03 | Enforcement | Guardrails never depend on the agent following instructions. The gate runs inside `push`, in CI on pull requests, and on update sets before promotion. | Bypassing skills or hooks still fails at the gate. |
| ASR-04 | Feedback latency | Checking one changed file is fast enough to run after every agent edit. | `check --changed` on one file < 300 ms p95 *(initial)*. |
| ASR-05 | Installability | One executable per platform (macOS arm64/x64, Windows x64, Linux x64/arm64). Its only prerequisite is `git`. | Clean-machine install test per platform in CI. |
| ASR-06 | Team scale | ServiceNow is pulled once per instance (centrally), not once per developer. Git distributes the result. | Pull runs unattended in a CI container. |
| ASR-07 | Instance scale | Incremental pull and derived data scale to large instances. Derived data (index, graph, table model) is a pure function of a commit. | 250k mirrored records; daily incremental pull < 5 min *(initial)*. |
| ASR-08 | Data protection | Credentials never reach the repository or logs. Secrets and business records are redacted or quarantined before anything is written to disk. | Secret scan of the mirror is a mandatory pull step. |
| ASR-09 | Context economy | The agent interface stays small: at most 12 MCP tools, about 8–12 skills, and a short instructions file. | Budgets checked in CI. |
| ASR-10 | Reviewability | A product owner can validate behavior without reading the code. Decisions are recorded as ADRs, simple rules are declarative files, and tests are named as specifications. | Every rule and use case has a readable spec. |
| ASR-11 | Extensibility | New rules, rule packs and artifact types are added without changing the core. | A rule pack is an installable package. |
| ASR-12 | Any change source | Governance validates a change regardless of origin: local workspace, git range or remote update set. | All three sources share one engine and one finding format. |
| ASR-13 | Determinism | Serialization is byte-identical across runs and platforms and stays compatible with hash contract v1. | `hash-vectors.json` parity tests. |
| ASR-14 | Commercial separability | Premium analysis can be shipped separately and protected without changing the core. | Premium code sits behind the `Validator` port only. |
| ASR-15 | Production read-only guarantee | Troubleshooting test and production instances can never write to them, regardless of agent behavior (including prompt injection from instance data) or defects in snagentic. | Write attempts with production profiles fail at the platform; write use cases are absent for those kinds; tested. |
