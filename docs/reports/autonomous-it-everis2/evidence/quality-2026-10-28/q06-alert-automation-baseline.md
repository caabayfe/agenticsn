# Q06 baseline: alert automation proposal (28 October 2026)

Scored from the morning run (`../capabilities-2026-10-28/83-op06-alert-automation-transcript.md`),
with the answer key built from the alert and the instance's rules tonight.

**Answer key:**

- Alert0010108: metric `disk_used_pct`, resource `/var/log`, node SAP WEB01, severity Warning,
  threshold 80 % in the description, **no CI bound**.
- Alerts in the instance: 75 in total, 34 in the last 30 days, **2** about disks. A replay would match
  2 alerts, so "handled automatically" saves little today.
- Alert management rules: 21, among them "Linux server actions" (inactive) and "Create Incident with
  AI Insight" (active). None of them targets disk alerts.

A top answer: a draft, inactive "Respond to alerts" rule with conditions taken from the alert
(`metric_name = disk_used_pct`, `resource = /var/log`, severity Warning or worse), an action that
reuses an existing pattern (create an incident with AI insight, or a Linux log-rotation playbook
behind an approval), the honest replay ("2 matching alerts in 90 days"), and a warning that the
alert has no CI, so routing by CI won't work.

**What happened:** the "Create alert automation" use case asked which kind (enrichment, response,
grouping), gave the link "Respond to alerts" and a generic proposal: "Run only for matching disk usage
warning alerts tied to /var/log", "assign to the appropriate support queue", "Deduplicate repeated
alerts". No field names, no threshold, no rule reused, no replay. Nothing was created (0 new
`em_alert_management_rule` records).

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 1: right idea, generic | 0: no field, value or rule from the instance | 0: no replay, missed the missing CI | 1: a link, nothing built | 1: English | 1: one run | **4 of 12** |

**Gap:** the use case doesn't read the alert's fields or the existing rules. Fix options: give it the
alert record and the rule list as context (a tool on `em_alert_management_rule`), or present the
step as "proposal, built by a person" and build the draft rule ourselves for the demo.
