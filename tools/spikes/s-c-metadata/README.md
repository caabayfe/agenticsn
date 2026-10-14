# Spike S-C: which ITSM pack artifacts are metadata, which are records

Question (spec 005 plan, section 3): for every artifact type waves 0 and 1 need, is it
`sys_metadata` (mirrored, pushed, captured in update sets) or a record (loaded per instance
through the data path)? Decides the pack's split between `metadata/`, `patches/` and `data/`.

Method: `classify.ts` walks each table's `super_class` chain in the pdi2 mirror (7,239 tables,
no instance call) and reads the collection dictionary entries for `update_synch=true` (2,407
entries carry the attribute; none of the record tables below, or their parents, does).
2026-10-14, pdi2 (Australia patch 7).

| Table | What | Metadata (push) or record (load) | Chain |
|---|---|---|---|
| contract_sla | SLA and OLA definitions | metadata | contract_sla → sys_metadata |
| cmn_schedule | schedules | metadata | cmn_schedule → business_calendar → sys_metadata |
| cmn_schedule_span | schedule entries | record | cmn_schedule_span → business_calendar_span |
| cmn_rota | on-call rotas | record | cmn_rota |
| cmn_rota_roster | rota rosters | record | cmn_rota_roster |
| cmn_rota_escalation_set | escalation sets | record | cmn_rota_escalation_set |
| sysrule_assignment | assignment rules | metadata | sysrule_assignment → sysrule → sys_metadata |
| dl_definition | data lookup definitions | metadata | dl_definition → sys_metadata |
| dl_u_assignment | assignment data lookups | metadata | dl_u_assignment → dl_matcher → sys_metadata |
| dl_u_priority | priority data lookups | metadata | dl_u_priority → dl_matcher → sys_metadata |
| sysevent_email_action | notifications | metadata | sysevent_email_action → sysrule → sys_metadata |
| sysevent_in_email_action | inbound email actions | metadata | sysevent_in_email_action → sysrule → sys_metadata |
| sc_cat_item_producer | record producers | metadata | sc_cat_item_producer → sc_cat_item → sys_metadata |
| sc_cat_item | catalog items | metadata | sc_cat_item → sys_metadata |
| kb_knowledge_base | knowledge bases | record | kb_knowledge_base |
| kb_knowledge | knowledge articles | record | kb_knowledge |
| sys_cs_topic | Virtual Agent topics | metadata | sys_cs_topic → sys_metadata |
| sys_ux_page_registry | workspace pages | metadata | sys_ux_page_registry → sys_metadata |
| sys_ux_app_config | workspace configuration | metadata | sys_ux_app_config → sys_metadata |
| pa_indicators | Performance Analytics indicators | metadata | pa_indicators → pa_indicators_definition → sys_metadata |
| sys_user_group | groups | record | sys_user_group |
| sys_user_role | roles | metadata | sys_user_role → sys_metadata |
| sys_properties | system properties | metadata | sys_properties → sys_metadata |
| cmn_location | locations | record | cmn_location |
| core_company | companies | record | core_company |
| cmdb_ci_service | services | record | cmdb_ci_service → cmdb_ci → cmdb |
| service_offering | service offerings | record | service_offering → cmdb_ci_service → cmdb_ci → cmdb |
| sys_choice | choices | record | sys_choice |
| sys_hub_flow | flows | metadata | sys_hub_flow → sys_hub_flow_base → sys_hub_flow_block → sys_metadata |
| sys_security_acl | ACLs | metadata | sys_security_acl → sys_metadata |

## Results

- **Metadata, delivered by push (and Fluent for flows):** SLA and OLA definitions, schedules
  (`cmn_schedule`), assignment rules, data lookups, notifications, inbound email actions, record
  producers and catalog items, Virtual Agent topics, workspace pages and configuration,
  Performance Analytics indicators, roles, system properties, flows, ACLs.
- **Records, loaded per instance (`data/`):** schedule entries (`cmn_schedule_span`), on-call
  rotas, rosters and escalation sets, knowledge bases and articles, groups, locations, companies,
  services and service offerings.
- **Choices** are records, but push already delivers them as child rows of their table (ADR-0025).
- **Consequence for the pack:** a schedule travels as metadata but its entries do not; the pack
  loads them with the schedule's sys_id as their key, in the same `after` order (schedule first).
  On-call (wave 1, B6) is data, not metadata: its rotas are loaded, not pushed.
- Not checked here: whether the platform captures any of the record tables in an update set by
  another route (as it does choices). A live push of one schedule entry would settle it for
  schedules; the data path works either way.
