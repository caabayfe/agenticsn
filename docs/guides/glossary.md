# Glossary

The words snagentic uses, in the order you meet them.

| Term | Meaning |
|---|---|
| **Instance** | A ServiceNow instance. snagentic knows three kinds: **development** (can be written), **test** and **production** (read-only, always). |
| **Profile** | An instance's entry in your workspace (`instances/<name>/instance.yaml`): its address, kind and user. It holds no secret. |
| **Workspace** | A dedicated git repository snagentic creates with `init`: the mirror, your Fluent source and the guardrail files. Kept apart from application code. |
| **Mirror** | Every metadata record of an instance, as files under `instances/<name>/metadata/`, as of the last pull. Read-only: you never edit it. |
| **Pull** | Reads the instance and commits what it found to the branch `servicenow-remote/<name>`. The first is complete and resumable; later ones fetch only what changed. |
| **Integrate** | Merges that branch into the one you are on. Where they disagree, the instance's copy wins. |
| **Shared mirror, puller** | In a team, one scheduled job (the *puller*) pulls and publishes the mirror to git; everyone else integrates it. |
| **Fluent** | The ServiceNow SDK's TypeScript for writing records as code. Your changes are written in it, under `source/<scope>/`. |
| **Adopt** | Converts a record the instance already holds into Fluent source, so you can edit it. |
| **Ledger** | `snagentic.ledger.yaml`: what each adopted unit last agreed with the instance. snagentic writes it; you don't. |
| **Unit** | One update: a record, or a list or section with its rows. What a plan compares and a push loads. |
| **Drift** | Someone changed an adopted record on the instance after your source last agreed with it. Pull, then `adopt --refresh`. |
| **Validate** | Builds your source and checks what your change *introduced* against the platform rules. A `block` finding stops a push. |
| **Rule** | A check with an ID such as SN-PERF-001, for security, performance, upgradability, manageability or user experience. |
| **Waiver** | A reviewed, committed, expiring exception to one rule for one file, in `waivers.yaml`. Agents can't edit it. |
| **Plan, plan id** | `plan-push` shows each unit a push would create, load or delete, the gate and any collisions, and returns an id. `push` loads that plan and only that plan. |
| **Gate** | The conditions a push needs: a plan id, passing validation (or a waiver), your confirmation, and an unchanged remote base. |
| **Update set batch** | Each branch's own update set, `snagentic: <branch>`, with a child per other application scope. |
| **Collision** | A record held in someone else's open update set. |
| **Take-over** | Marks an out-of-box record, as the platform shipped it, as this branch's, so the next plan loads your source over it. Refused if the customer already changed it. |
| **Accelerator pack** | Ready-made Fluent source and data templates for one product area, installed from a plan a platform admin reads first. |
| **Skill** | Guidance an agent follows for one workflow: design, build, review, explain, deliver, document. Guidance, never enforcement. |
| **MCP** | The protocol your coding agent uses to call snagentic's tools. snagentic offers 13 tools. |
| **Hibernating** | A developer instance idle for a while goes to sleep and answers nothing useful until you wake it at developer.servicenow.com. |
| **Evidence** | In documentation: a record, and its hash when checked, that a sentence cites. When the record changes, the sentence is flagged. |
| **Census** | `docs census`: every application that reaches a documented process's tables, so no feature goes undocumented. |
