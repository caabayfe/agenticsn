# 0008. Open core with a sealed premium engine behind the `Validator` port

- Status: Proposed
- Date: 2026-10-05
- Requirements: ASR-11, ASR-14

## Context

The product may be sold. JavaScript ships readable code, and skills are plain text by
necessity. Realistic threats:

- **Enterprise customers bypassing the license.** Low likelihood: procurement and audits
  stop this.
- **Competitors copying detection logic.** Medium likelihood.
- **Individuals using it for free.** Acceptable; they are the community.

Rule content (which findings exist, remediation text) is visible to any user in any
language. What can be protected is the **implementation** of premium analysis and the
**update stream**.

## Decision (proposed)

- **Open TypeScript core:** sync, knowledge, CLI, MCP, agent packs, rule engine and
  SDK, and the basic rule pack. Contributors only work here.
- **A sealed premium engine:** a private Rust crate using **oxc**, compiled to **one
  WebAssembly module**, embedded in the commercial binary.
  - It is a **pure function** behind the `Validator` port, with a versioned JSON contract:
    artifacts + change set + facts in, findings out.
  - It covers architecture, performance, security and context analysis.
  - **License verification happens inside the module** (an Ed25519-signed token checked
    against an embedded public key), so patching the TypeScript wrapper unlocks nothing.
  - Rule metadata inside the module is encrypted.
- **Moat:** a continuously updated premium rule stream for each ServiceNow release, plus
  licensing terms.
- **Later option:** the same contract served as a hosted endpoint.

## Consequences

- Community contribution stays in TypeScript.
- Premium logic is about as hard to reverse as a native binary.
- Two languages, with a narrow, contract-tested boundary between them.
- Customer metadata never leaves their network.

## Open items

- **Core license:** Apache-2.0 (community appeal) or FSL (stops competitors reselling).
- **Spikes:**
  - oxc inside WASM on a real script corpus;
  - the compiled binary with WASM still meets the hook latency target;
  - the license cannot be bypassed by patching the wrapper;
  - `strings` and decompiler output shows no readable rule text.

## Alternatives considered

- **All TypeScript, obfuscated.** A speed bump of hours to days; deobfuscators exist.
  Possible fallback.
- **Hosted-only premium analysis.** Strongest protection, but operations work and
  data-sovereignty objections.
- **Everything in Go or Rust.** Protected, but conflicts with ADR-0005 and community
  contribution.
