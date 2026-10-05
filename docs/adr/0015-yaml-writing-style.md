# 0015. YAML writing style

- Status: Accepted
- Date: 2026-10-05
- Requirements: ASR-10, ASR-13
- Amends: 0007

## Context

Spike S2 showed that reading v1 mirrors is exact (279,983 / 279,983 hashes), and that
reproducing v1's libyaml bytes stops at about 82% of files and buys nothing visible.

## Decision

snagentic writes `record.yaml` and other data files in its own documented style:

- keys sorted by code point; no line wrapping;
- strings plain when unambiguous, single-quoted when quoting is needed;
- multi-line values as literal blocks (`|-`, with `|+` or quoting when trailing newlines
  must be kept);
- **reading uses the failsafe schema**: every scalar is a string, never a boolean,
  number or date.

The S2 corpus results (full round trip, 51 adversarial strings) become permanent
regression tests.

## Consequences

- Hashes and values are unchanged; the first write of a v1 mirror is a single
  formatting-only commit touching about 18% of `record.yaml` files.
- Agents and reviewers read multi-line values as plain text instead of quoted strings
  with doubled blank lines.
