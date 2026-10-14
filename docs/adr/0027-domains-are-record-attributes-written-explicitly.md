# 0027. A record's domain is an attribute, written explicitly on push

- Status: Accepted
- Date: 2026-10-13
- Requirements: ASR-01, ASR-02, ASR-05
- Amends: 0017 (flat record layout), spec 004 (plan and push)
- Relates to: 0025 (records created in their application), spec 006

## Context

Managed service providers run ServiceNow domain-separated, one domain per customer: a record
in a domain applies to that domain and the domains below it. snagentic used the domain only to
choose a file's folder (`domains/<domain>/<scope>/<class>/…`, ADR-0017). Building an
application on pdi2, which has a TOP > Default hierarchy, showed what that costs:

- 37 records an agent created came back in the Default domain. Integrate kept two copies of
  each (fixed in 1.5.1: identity is scope, class and sys_id, in any domain), and nothing in the
  plan had shown which domain they would land in.
- Metadata in Default applies only to Default and below. An application's UI actions and
  business rules belong in global (or TOP) to run for every customer.

Spike S12 (`tools/spikes/s12-domains/probe.ts`) wrote through the Table API on pdi2 the way push
writes, with the record's application current:

| Write | Result |
|---|---|
| Insert, no `sys_domain` | global |
| Insert, `sys_domain: global` | global |
| Update `sys_domain` Default → global | moved to global |
| The update in the update set | carries `<sys_domain>global</sys_domain>` |

The instance honours an explicit domain on insert and on update, and the update set carries it
to the next instance. Why earlier pushes landed in Default could not be reproduced; push should
not depend on it.

## Decision

1. **A domain is an attribute of a record, not part of its identity.** Identity is scope, class
   and sys_id (1.5.1). The file's folder still shows the domain, as ADR-0017 lays out.
2. **Push writes the domain on every create**: the record's `_meta.sys_domain`, or `global`
   when the file names none. The instance never chooses.
3. **A domain change is an update.** Editing `_meta.sys_domain` writes `sys_domain`; the plan
   lists it among the fields, so a reviewer sees the move.
4. **Agents are told the domains.** `status` names the instance's domains (from the operational
   inventory) when it has any besides global; the build skill says which domain to build in:
   global for an application's logic, a customer's domain only for that customer's changes.

Not decided here: domain overrides (`sys_overrides`) in `describe` and `validate`, and a
per-instance default domain in `instance.yaml` (spec 006, A6 and A4b).

## Consequences

- A create's domain is in the plan and in git, never an accident of the session.
- Moving the Access Review application's records from Default to global is a reviewed push.
- Instances without domain separation are unaffected: their records are all in global, which
  is what push now sends.
