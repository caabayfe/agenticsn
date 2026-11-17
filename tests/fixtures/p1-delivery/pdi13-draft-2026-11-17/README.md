# PDI13 raw draft flows — 2026-11-17

Five pack-owned flows from the full-pack PDI13 install, source candidate `193f0539`,
approved install plan `394eefb02dc03da3`. The original native Fluent load finished
with HTTP 200 in transaction `09c6b62e93a89310097a72cdfaba10fb` after the client
timed out, leaving these new definitions inactive and unpublished.

`*-built.xml` comes from a credential-free SDK 4.14.0 worker building a copy of the
unchanged workspace. All five unit digests match the original pending receipts.
`*-capture.xml` comes from the official CLI's read-only export of original global
update set `4aa63e6e93a89310097a72cdfaba100f`. The export's policy withheld 122 other
updates; these five flow captures were available in full. The generic live query
truncated large payload strings, so it was not used as XML comparison evidence.
Only these owned metadata definitions are retained here; no credential, business
record, mirror or journal is copied.

The cases cover generic and MIM SLA warnings, request re-approval, task ordering and
approval. Raw draft comparison checks every authored child directly, with no
publication-generated runtime rows or snapshot substitution. It does not certify
delivery or permission to overwrite a different live graph. The separate live
graph proof, unchanged version/digest/target, normal plan approval, publication and
final capture/read-back checks remain required. No native recovery, publication
or receipt clearing is claimed from these static fixtures.
