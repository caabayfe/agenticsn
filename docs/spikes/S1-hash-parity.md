# S1. Hash parity

- Date: 2026-10-05
- Confirms: ADR-0007 (hash contract v1)
- Verdict: **go**

## Question

Does the TypeScript kernel produce exactly the hashes snagentic v1 produces, including
edge cases where Python and JavaScript behave differently?

## Method

1. Copied the five v1 vectors (`tests/fixtures/hash-vectors.json`) unchanged.
2. Generated 2,006 vectors with `tools/spikes/s1_generate_hash_vectors.py`, which imports
   and calls **v1's own `record_hash`** (seed `20261005`):
   - 2,000 random records: 0–12 fields; ASCII, CR/LF mixes, control characters, DEL,
     Latin-1, high Basic Multilingual Plane characters (U+FFFD, U+E000, U+FEFF),
     characters outside it (emoji, U+10FFFF), lone surrogates, trailing newlines;
     snake_case keys and occasional Unicode keys;
   - 6 crafted records: key ordering of an astral character against a high BMP
     character, DEL with controls, newline-only scripts, trailing spaces, `__proto__` and
     `constructor` keys, lone surrogates.
3. The spec test `reproduces every extended vector computed by the v1 Python code`
   compares all of them against `recordHash`.

## Differences between Python and JavaScript found and handled

| Behavior | Python v1 (`json.dumps(ensure_ascii=True, sort_keys=True)`) | `JSON.stringify` | Kernel |
|---|---|---|---|
| Non-ASCII characters | `é` escapes | kept as is | escaped, lowercase hex |
| DEL (0x7F) | `\u007f` | kept as is | escaped |
| Key order | by Unicode code point | by UTF-16 code unit (differs for astral vs U+E000–U+FFFF) | by code point |
| `__proto__` key | ordinary key | ordinary with `JSON.parse`, but dangerous when assigned | built with `Object.fromEntries` |
| Non-integer numbers | `1.0`, `1e+16` | `1`, `10000000000000000` | rejected; the contract only uses strings |
| Surrounding whitespace (scope folders) | `str.strip()` includes `\x1c`–`\x1f`, `\x85` | `trim()` includes `﻿` instead | Python's set reproduced |

## Measurements

- 5 / 5 v1 vectors match.
- 2,006 / 2,006 extended vectors match.
- Hashing all 2,011 vectors takes well under a second within the test run.

## Decision

Go. The hash contract is kept unchanged. To regenerate the extended vectors, run the
command in the generator's docstring; the seed makes the output reproducible.
