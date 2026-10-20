# 010g. Open questions are records (ADR-0041)

- Status: accepted (2026-10-20); on-call piloted on paper, building

## 1. Why

On pdi2 the documentation holds about 335 open questions: some 294 numbered items in 109
`{label=OPEN-QUESTION}` sections on 100 pages, and 41 `status: question` features. They have no
id, no state and no answer, the same question repeats on every page it touches, and decisions,
screen checks and hidden values are mixed in one list.

## 2. questions.yaml

```yaml
# processes/on-call/questions.yaml
questions:
  - id: Q03
    ask: Escalation logging is off; should it be on before the first shifts and trigger rules?
    kind: decide            # decide | check | hidden
    who: owner              # a process.yaml role id, owner or platform
    about:
      - record: sys_properties/110b43c9c70b00100c54885827c2605f#value
        hash: …             # set by docs pin
    status: open
  - id: Q25
    ask: What do an escalation's messages, work notes and Escalation Log show?
    kind: check
    who: platform
    after: [Q01, Q02, Q03]
    status: open
  - id: Q11                 # an illustration: not a real answer
    ask: …
    status: answered
    answer: Acceptable on pdi2; keys are revoked by the group-leave flow.
    by: process owner
    on: 2026-10-24
```

A page cites `[Q03]` (or `[on-call/Q03]` from another process); a page that applies an answer
cites evidence `E09: { answered: Q11, how: …, result: … }`.

## 3. Build in this order

| Step | What | Test |
|---|---|---|
| Q1 | Parse `questions.yaml` (domain), with errors for unknown ids, `after` cycles, unknown roles | unit |
| Q2 | Citations `[Qnn]` in pages and `question:` in features.yaml; the generated *Open questions* section | site |
| Q3 | `answered:` evidence | evidence unit, site |
| Q4 | `docs pin` pins `about` hashes; `docs check`: answered-not-applied, question-may-be-moot, unasked-question, unstructured-question | check-docs |
| Q5 | The tracker page and the process card count | site |
| Q6 | The skill: write questions, not sections; how to migrate a process | golden |
| Q7 | Migrate pdi2's nine processes, one agent pass each, reviewed | `docs check` clean |
| later | `docs questions export` / `import`, if owners need it | — |

## 4. Pilot: on-call on paper

On-call's 10 pages ask 42 questions and its features.yaml 3. Merged, they are 25. *From* names
the source: page (c = configure, o = operate) and item number, or the feature.

### Decisions for the owner (16)

| Id | Question | From | About |
|---|---|---|---|
| Q01 | Which groups need a shift, who manages each, and are shift managers named in group preferences or given `rota_manager`? | c/set-up-shift 1, o/set-up-shift 3 | — |
| Q02 | Which tables and conditions start the on-call flows, and which flow does each group's trigger rule use? | c/escalation 1, o/escalation 2, o/respond 4 | — (no `trigger_rule_table_cfg` records) |
| Q03 | Escalation logging is off: on purpose, and should it be on before the first shifts and trigger rules? | c/respond 1, c/escalation 3, o/respond 1 | `sys_properties/110b43c9…#value` |
| Q04 | Are SMS, voice and conference calls wanted, and is a Notify telephony provider set up for them? | c/respond 3, c/escalation 2, o/respond 3, o/escalation 3, feature conference-calls | `sys_properties/5e1029aa…`, `on_call_communication_channel_config/1a726d2e…` |
| Q05 | May members ask for their own time off, with or without approval, who approves, and may shifts overlap? | c/own-schedule 1, c/set-up-shift 4, o/own-schedule 3, o/set-up-shift 4 | `sys_properties/7d7f3d85…#value`, `sys_script_include/9e1176a4…` |
| Q06 | Should email replies work for problem, change and other tasks, not only incident? | c/respond 4, o/respond 5 | `sysevent_in_email_action/ae4aa870…` |
| Q07 | Should a catch-all wait time be set for the instance? | c/escalation 4, o/escalation 4 | `sys_properties/a0f693a8…` |
| Q08 | Should the incident form's *On-Call Roster and Escalation details* link be switched on? | c/see-on-call 4, o/see-on-call 4 | `sys_ui_action/7e86cef1…` |
| Q09 | Are Slack or Microsoft Teams direct messages wanted from On-Call Schedules? | c/see-on-call 3 | `sys_ui_page/b53fad60…` |
| Q10 | Should a group with only a draft shift take its members into a discussion, or are shifts made only when ready? | c/see-on-call 2 | `sys_script_include/d9c7a32b…` |
| Q11 | Is a personal API key in the calendar subscription link acceptable, and how is it revoked when someone leaves a group? | c/own-schedule 2 | `sys_script_include/cbf1a0c2…` |
| Q12 | Accepting sets the assignee without business rules: should assignment notifications and SLAs react? | c/respond 5 | `sys_script_include/08886bed…` |
| Q13 | Are group or schedule templates to be prepared for the support groups? | c/set-up-shift 2, o/set-up-shift 5 | `sys_app_module/ac97c155…` |
| Q14 | Should the workspace's on-call pages (`com.snc.sow_on_call`) be installed, or does on-call stay in the classic interface? | feature workspace-on-call | — (plugin absent) |
| Q15 | Is anyone meant to get on-call pushes on the mobile app? | feature mobile-push | — (store app, nothing mirrored) |
| Q16 | The SMS of *On-Call: Assign and Notify* is a placeholder: is it replaced at run time, or must the flow be copied and corrected? | c/respond 2, o/respond 6 | `sys_hub_flow/35ef9d20…` |

### Hidden values (3)

| Id | Question | From | About |
|---|---|---|---|
| Q17 | What does `calendar_read_roles` hold, and does it include `oc_read`, which the menu offers? | c/see-on-call 1, o/see-on-call 3 | `sys_app_application/e1e620df…` |
| Q18 | Is `com.snc.on_call_rotation.force_use_schedule_engine` set? Without it new shifts use the 2024 engine. | c/set-up-shift 3 | `sys_script_include/1d534927…` |
| Q19 | Which record defines `$oc_user_preferences.do`? | c/own-schedule 3 | — (not in the mirror) |

### Screen checks (6)

| Id | Question | From | After |
|---|---|---|---|
| Q20 | What do On-Call Calendars, Schedule Report, Overview, Escalations Report and My Schedule Report show? | o/see-on-call 2, o/own-schedule 1 | — |
| Q21 | What does a card show with someone on call, and does *Send a direct message* appear? | o/see-on-call 1 | Q01 |
| Q22 | Which channels does *Contact Attempts* offer, and can a member add a device not on their profile? | o/own-schedule 2 | — |
| Q23 | Do the escalation page, the escalation designer and the trigger rule form show the fields the records give? | o/escalation 1 | — |
| Q24 | Do the wizard's Members, Escalation Setup and Review steps, and the Add, Remove and Move forms, show these fields? | o/set-up-shift 1, 2 | — |
| Q25 | What do an escalation's messages, work notes and Escalation Log show? | o/respond 2 | Q01, Q02, Q03 |

### What the pilot shows

- 45 → 25 questions; the owner's list is 16, the rest is the platform team's or the next walk's.
- The repeated ones are the important ones: Q04 (telephony) is asked 6 times, Q05 (time off) 4,
  Q02 and Q03 3 each. Answering those four unblocks most of the on-call pages.
- 5 questions have no record to watch (Q01, Q02, Q14, Q15, Q19): `about` is optional, and those
  can only be closed by an answer.
- Q04 merges a decision (wanted?) and a hidden value (provider set up?); the owner answers the
  first, and the answer decides whether the second matters. One question with one `who` is
  enough when the decision comes first.
