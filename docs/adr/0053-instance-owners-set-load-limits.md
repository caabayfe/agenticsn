# 0053. Instance owners set load limits; one scheduler per instance; the cost report is opt-in

- Status: Proposed (2026-11-10, for the product owner)
- Date: 2026-11-10
- Requirements: G1, G2, ASR-16
- Amends: 0016, section 4 (load governance) and its appendix "Server cost, measured by every pull"
- Relates to: 0012 (test and production are read only), 0020 (settings pinned by environment
  variables), spec 014 step P1 (findings PERF-04, PERF-05, PERF-06)

## Context

ADR-0016 §4 promises one request scheduler per instance, shared by every operation in a process,
with a per-run request budget. The enterprise readiness review (spec 014) found the code does
less than that, and that an instance owner has no way to bound what snagentic may do to their
instance:

1. **No shared scheduler (PERF-04).** The composition root (`packages/cli/src/main.ts`) builds a
   new `RequestScheduler` on every `connections.open`. `connect`, `pull`, `doctor` and
   `auth login` each open their own, so concurrent MCP tool calls each get their own adaptive
   controller (2 rising to 4). Two pulls and a doctor in one MCP server can reach 12 requests in
   flight against one instance, and a 429 seen by one call does not slow the others. The class
   comment says "one per instance and process"; nothing enforces it.
2. **No budget, no administrator limits (PERF-04).** The budget code exists in the scheduler but
   is never configured, so every run is unlimited. Maximum concurrency (4) and the absence of a
   rate limit are fixed in code; a production owner cannot ask for less.
3. **Timeouts add load instead of removing it (PERF-05).** The transport aborts a request after
   90 s; the scheduler turns that into a network error, and the retry policy retries a GET up to
   five times. The controller only observes responses, so a timeout never lowers concurrency, and
   the pager only shrinks its page on the instance's own "transaction cancelled" message. A page
   that is too slow for the client is sent again, at the same size, up to four more times, while
   the instance may still be working on the first one.
4. **The cost report is itself a cost (PERF-06).** Every pull, production included, ends with an
   aggregate over `syslog_transaction` filtered by `sys_created_on` and `user_agent`. `user_agent`
   is not indexed, and the log is one of the largest tables on a busy instance, so on production
   the measuring request can cost more than the idle pull it measures. The `Server-Timing`
   header snagentic already reads carries only queue waits (`sem_wait`, `sesh_wait`), not
   response, SQL or CPU time, so it cannot replace the report.

## Decision

1. **One scheduler per instance per process.** The composition root keeps a pool of schedulers
   keyed by instance URL. Every connection to the same instance, from any use case, CLI command
   or concurrent MCP tool call, sends through the same scheduler: one set of concurrency slots,
   one adaptive controller, one rate limiter. Each connection still counts its own requests,
   retries, timeouts and budget (a *run*), so a pull reports its own load, not its neighbours'.
2. **Three load limits, with defaults by instance kind.**

   | Limit | development | test, production |
   |---|---|---|
   | `max_concurrency` (the adaptive controller's ceiling) | 4 | 2 |
   | `requests_per_second` (spacing between request starts, per instance) | 10 | 5 |
   | `request_budget` (requests per run) | 20,000 | 20,000 |

   The budget is about four times the measured full pull of a PDI (5,180 requests). A run that
   reaches it stops with `request-budget-exhausted`; a full pull keeps its checkpoint, so running
   it again resumes where it stopped.
3. **Who may set them, and in which direction.**
   - `instance.yaml` may hold a `load:` block (`max_concurrency`, `requests_per_second`,
     `request_budget`). Values there can only **lower** the limits: the file is committed, and an
     agent or a pull request must not be able to raise the load on an instance. A higher value is
     ignored (the lower default applies).
   - Environment variables `SNAGENTIC_<NAME>_MAX_CONCURRENCY`,
     `SNAGENTIC_<NAME>_REQUESTS_PER_SECOND` and `SNAGENTIC_<NAME>_REQUEST_BUDGET` (named like
     ADR-0020's credential variables) are set by whoever runs the machine or the CI job. They may
     lower all three, and may **raise only the budget**, the one limit a large instance
     legitimately needs more of. Concurrency and rate stay at or below the kind's default.
   - The effective limit is the lowest of the default (or the raised budget) and the file.
     Invalid values (not a positive integer) are an error that names the variable or file.
4. **A timeout is pressure.** A request the client abandons after its timeout counts as pressure
   for the adaptive controller (as a 429 or 503 does) and is counted in the run's statistics
   (`timeouts`). A timed-out GET is retried at most once. A pager listing asks the scheduler not
   to retry and retries the page itself, once, at a smaller page size. A second timeout fails the
   run with `request-timed-out`.
5. **The server cost report is opt-in and development only.** `pull --cost` measures the run's
   server cost from `syslog_transaction` after the pull. Without the flag no transaction-log
   request is made. On a test or production instance `--cost` is refused before the pull starts.
   The pull output keeps `serverCost` (null when not measured) and adds `serverCostRequested`, so
   a reader can tell "not asked" from "the log is unreadable".

## Consequences

- ADR-0016 §4 holds in code: concurrent MCP calls share one controller and one rate limit, and
  pressure seen by one slows all of them.
- An instance owner can bound snagentic's load through the committed `instance.yaml` (reviewed
  like any other change) or through the machine's environment, and nobody can raise concurrency
  or rate above the built-in ceilings.
- Production pulls are slower by design (2 at a time, 5 per second). An idle incremental pull
  (22 requests) is unaffected in practice; a full pull of a large production instance takes
  longer, and may need `SNAGENTIC_<NAME>_REQUEST_BUDGET` or a second, resumed run.
- ASR-16's "server cost of every pull is reported" becomes "of every pull that asks for it, on
  development". The measured numbers in ADR-0016's appendices came from development instances
  and remain the reference.
- `pull` output gains `timeouts` and `serverCostRequested`; the generated command reference is
  updated.
- Use cases that run their own parallel loops (fingerprints, record downloads) still start up to
  four requests at once; the scheduler is the only gate, so a lower `max_concurrency` queues them.

## Alternatives considered

- **Let `instance.yaml` raise limits too.** Simplest, but the file is committed and agents edit
  workspaces; one commit could multiply the load on production. Rejected.
- **Let environment variables raise concurrency and rate.** Useful for a dedicated integration
  node, but no measurement shows the need, and ADR-0016 chose 4 deliberately. Can be added by a
  later ADR with evidence.
- **One scheduler per use-case call, with a process-wide semaphore only.** Keeps per-run
  statistics trivially, but leaves one adaptive controller per call, so pressure seen by one call
  does not slow the others. Rejected.
- **Replace the cost report with summed `Server-Timing`.** No extra request, but the header holds
  only queue waits, not server, SQL or CPU time, so the report would no longer measure cost.
  Rejected; the waits are already reported as `semaphoreWaitMs`.
- **Keep the cost report on every pull, filtered by indexed fields only.** The log has no indexed
  field that identifies snagentic's requests; matching by transaction id would need one request
  per batch of ids. Rejected for now; revisit with the large-instance measurements of step P3.
- **Retry timed-out GETs as other network errors (up to five times).** Each retry can start
  another long transaction on the instance while the first may still run. Rejected.
