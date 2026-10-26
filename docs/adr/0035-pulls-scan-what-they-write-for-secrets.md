# 0035. Pulls scan what they write for secrets

- Status: Accepted (product owner, 2026-10-26)
- Date: 2026-10-17
- Requirements: ASR-08 (data protection), ASR-07 (instance scale), ASR-16 (instance load)
- Relates to: 0034 (typed property values), 0031 (Fluent authoring), 0033 (adopt), security
  finding S2

## Context

ASR-08's fit criterion says "secret scan of the mirror is a mandatory pull step". No such step
exists: pulls redact by field (secret types and names, property values, ADR-0034), but a secret
written into a script, a SOAP parameter or an HTML template reaches the mirror, then git, then
every clone. ADR-0034 assumed the scan existed; its implementation note records that it doesn't.

Candidate patterns were measured against the whole pdi2 mirror (489,612 records), read-only,
values masked:

| Pattern | Hits | Verdict |
|---|---|---|
| Private key block (`-----BEGIN … PRIVATE KEY-----`) | 0 | |
| AWS access key id (`AKIA` + 16) | 1 | real: a SOAP message parameter |
| GitHub, Slack, Google API tokens; JWTs | 0 | |
| URL with `user:password@` | 0 | |
| `Authorization: Basic/Bearer <literal of 16+>` | 0 of 2,562 lines mentioning authorization | |
| `Basic/Bearer <20+ chars>` anywhere | 8 | all false: CSS classes (`basic pwd-reset`) |
| `password=…` (the log-cleaning pattern) | 9 | almost all false: encoded conditions, templates, `password=false` |

Two things follow. Loose patterns are useless here, and their replacement would corrupt code. And
high-confidence token shapes find real secrets at almost no cost in false positives.

## Decision

1. **Every instance-derived file a pull writes is scanned before it is written**: record files,
   script and other field files, child-row files, applications, catalog and operational
   inventory. The scan is a pure function over canonical text, in the metadata domain, applied
   where records and documents are rendered. No request to the instance.
2. **Only high-confidence patterns**, each with an id: private key blocks, AWS access key ids,
   GitHub, Slack and Google API tokens, JWTs, credentials in URLs, and literal tokens in an
   `Authorization` header. A pattern joins the list only after it is measured on a real mirror
   with no false positives, and with a test of a triggering and a passing sample.
3. **A match is redacted in place**, never the whole field: the secret becomes
   `[redacted:<pattern id>]` and the rest of the text is kept. The record's `_meta` lists the
   fields redacted this way. The pull goes on: refusing it would leave the mirror stale over
   instance data the user can't fix at once.
4. **The pull reports** each record redacted this way, by path and pattern, never the value, so
   the secret can be removed from the instance and the credential rotated.
5. **adopt applies the same scan** to the units it would write (extending S2): a unit with a match
   is refused, as source must not hold what the mirror doesn't.
6. **Existing mirrors are scanned once without the instance**: on the first pull after upgrading,
   the committed mirror files are scanned locally and those with a match are rewritten in that
   pull's commit. A separate `secretScanVersion` in sync state records completion only after the
   commit succeeds. Git history keeps the old content: the report says to rotate the credential;
   rewriting history stays the user's decision.
7. ASR-08's fit criterion becomes: "Every file a pull writes is scanned for high-confidence secret
   patterns; matches are redacted before writing and reported."

## Consequences

- A token pasted into a script no longer spreads through git; the instance's owner learns of it.
- The scan is a backstop, not a guarantee: a plain password in a string literal has no shape to
  match, and stays the business of field redaction and review.
- A redacted script differs from the instance's. The mirror is read-only (ADR-0031) and plans read
  the instance live (ADR-0033), so nothing writes the marker back.
- CPU cost only, linear in what a pull writes; measured in the pull report's phase times.
- On pdi2 the first pull after upgrading rewrites one record (the SOAP message parameter).

## Alternatives considered

- **Refuse the pull on a match.** Rejected: the mirror goes stale over data only the instance's
  owner can fix, and the incremental watermark can't move past it.
- **Redact the whole field.** Rejected: a script loses all its code for one token, and the agent
  loses what it needs to explain the record.
- **Reuse the log-cleaning patterns** (`redactSecrets`). Rejected by measurement: 9 hits on pdi2,
  almost all false, and their replacement corrupts code.
- **A third-party scanner (gitleaks, trufflehog).** Rejected: a native dependency or a second
  binary for every user (ADR-0005), and their broad rules bring the false positives measured above.
