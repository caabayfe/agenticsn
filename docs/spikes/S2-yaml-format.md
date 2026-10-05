# S2. YAML format

- Date: 2026-10-05
- Confirms: ADR-0007 (disk format and hash contract), ASR-13
- Verdict: **go.** The TypeScript reader is fully compatible with v1 mirrors.
  **Decision needed** on the writing style (recommendation below).

## Question

Can TypeScript read v1 mirrors exactly, and should it write YAML byte-identical to v1 or in
its own documented style?

## Corpus and method

- The full v1 mirror of the PDI on this machine
  (`../snagentic/.snagentic/pdi/mirror-tree`): **279,983 records** written by v1 with
  libyaml (`CSafeDumper`, sorted keys, `allow_unicode=False`, width 100). It contains
  ServiceNow out-of-box code, so it stays outside this repository; only aggregate results
  are recorded here.
- `tools/spikes/s2-yaml-format/compare.ts` runs three checks over every record (about
  2.5 minutes):
  - **(a) reader parity:** read `record.yaml` and the exploded script files, recompute the
    hash with the kernel's `recordHash`, and compare with the hash v1 stored in
    `_meta.yaml`;
  - **(b) writer byte parity:** re-emit `record.yaml` with the `yaml` library configured
    to imitate v1 as closely as possible, and compare bytes;
  - **(c) own style:** write each record in the proposed style, read it back, and require
    every value to come back identical. The same check runs on 51 adversarial strings
    (`yes`, `null`, `~`, `0o17`, `.inf`, dates, leading or trailing spaces, CR/LF, `#`,
    `- `, `: `, Unicode, emoji, U+2028, DEL, BOM, 500-character values, and others).

## Results

| Check | Result |
|---|---|
| (a) hashes recomputed by TypeScript equal v1's stored hash | **279,983 / 279,983 (100%)** |
| (b) v1-imitating writer byte-identical to v1 | 228,353 / 279,983 (81.6%) |
| (b) causes of differences | long values wrapped by libyaml 30,293; multi-line values 15,711; non-ASCII escaping 1,737; other quoting 3,889 |
| (c) own style round-trips every corpus value | **279,983 / 279,983 (100%)** |
| (c) own style round-trips the adversarial strings | **51 / 51** |
| (c) own style byte-identical to v1 (files unchanged by migrating) | 228,796 / 279,983 (81.7%) |
| Total size, v1 vs own style | 214.5 MB vs 208.6 MB |

## Findings

1. **Reading is solved.** `record.yaml` only ever holds strings, so the reader uses YAML's
   *failsafe* schema: every scalar is text, never a boolean, number or date. This
   reproduced every v1 hash. It is also the correct semantics for ServiceNow, where
   `active: true` is the string `"true"`.
2. **Exact byte parity is a moving target.** v1 used libyaml, whose line wrapping differs
   even from PyYAML's own pure-Python emitter. Imitating it in TypeScript stops at about
   82% without reimplementing libyaml's folding rules.
3. **Our own style changes no more files than imitation does**, and it is more readable:

   ```yaml
   # v1 (libyaml)                          # own style
   description: 'Raises priority when      description: |-
                                             Raises priority when
     the caller is a VIP.                    the caller is a VIP.


     See KB0012345.'                         See KB0012345.
   ```

## Recommendation (needs your decision)

Adopt the **own style**, documented as part of ADR-0007:
- sorted keys, single quotes when quoting is needed, no line wrapping;
- multi-line values as literal blocks (`|-`), which reads naturally for agents and in
  diffs;
- read with the failsafe schema (all values are strings).

Migrating an existing v1 mirror is a **single formatting-only commit** that rewrites about
18% of `record.yaml` files. Values and hashes are unchanged, so no record looks modified
to plan or push. The alternative, reimplementing libyaml's wrapping, buys nothing users
can see.
