# P1 delivery fixtures

`acceptance.now.ts` and `calculate.js` define a pure calculation action, subflow and flow.
Setup replaces the batch tag and reserved trigger record ID. Never create that trigger ID.

`pdi11-2026-11-14/built/` contains the embedded SDK 4.14.0's original build XML.
`captured/` contains the corresponding real published update-set payloads from development
instance pdi11 (Brazil patch 1). These are this test's metadata, not customer business data.
Usernames and timestamps were normalized, and payloads passed through secret redaction.
Physical IDs were retained to preserve authored, snapshot and parent identity relationships.

Publication adds snapshot graph copies, generated runtime rows, parameter descriptors and
defaults, and rewrites action/subflow definition references to snapshot IDs. Tests verify
the authored graph beside those additions and reject changed/missing authored rows, draft
definitions, unrelated or non-master snapshots, and unverifiable references. Only observed
normalization rules are allowed; unknown authored content still fails verification.

See `specs/014-delivery-verification/plan.md` and ADR-0050 for the live acceptance results,
recovery behavior and limits. The standalone `tests/live/p1/` scripts are an explicit audit
harness for this run, not automatically enabled live tests.
