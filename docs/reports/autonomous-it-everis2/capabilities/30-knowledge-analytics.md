# 30. Knowledge, search, analytics and employee experience (everis2, 2026-10-28)

Scope: knowledge (generation, duplicates, gaps, health, Knowledge Center), AI Search and Q&A,
knowledge graph, web search, analytics (text to analytics, query generation, dashboard
summarization, insights dashboards, AI Lens), documents, surveys, translation, the Group and
Action Framework (GAF), and the Moveworks skills on global.

Evidence root: `M = spaces/everis2/instances/everis2/metadata`. Usage figures are from `usage.md`
(180 days). Skill state is `active/in product` from `skills.txt`. "(inferred)" marks anything
not read directly from the mirror.

Two corrections to the brief:
- `sn_ef_gen_ai` is the **Error Framework** (platform error codes), not surveys. Surveys live in
  `sn_uxc_gen_ai` (Survey Analysis and survey response agents).
- `sn_kbs_genai` is **Keyboard Shortcut Suggestions**, not knowledge.

---

## 0. What "Hierarchical capability (POV)" and "Group capability (Topic)" are, and why 359 calls

**What they are.** Both are capabilities of the **Group and Action Framework** (`sn_gaf`), the shared
engine ServiceNow uses to cluster records and derive actions from the clusters:
- `Hierarchical capability (POV)` (`M/sn_gaf/sys_one_extend_capability/hierarchical-capability-pov--f0622c97…yaml`):
  "create a Point of View (POV) for a record". One LLM call **per record**: it extracts a structured
  view (symptom, cause, resolution) that clustering then works on. Results go to `sn_gaf_record_pov`
  (`GAFConstants.TABLE_RECORD_POV`, `M/sn_gaf/sys_script_include/gafconstants--…script.js:6`).
  `POV_MAX_RECORDS: 20000`, 3 retries per record.
- `Group capability (Topic)` (`…/group-capability-topic--266f0bef…yaml`): "generate topics on a group
  of records". One call **per cluster**, to name it.

So 359 POV + 31 Topic calls is the signature of batch clustering: about 360 records sampled into
about 31 clusters (about 12 records per cluster). Nobody clicked anything; these are scheduled jobs.

**Who runs GAF on everis2** (all from the mirror):

| Pipeline | Schedule | Evidence | Runs inside the 180 days |
|---|---|---|---|
| **Now Assist ITSM Insights dashboard** (incidents): `GAF ITSM Insights Dashboard grouping` → `GAF topics` → `…action strategy` | Every 30 days from 2026-07-07 | `M/sn_itsm_gen_ai/sn_gaf_sysauto_script/gaf-run-offline-flow--69bd9996…yaml`; one-off `GAF ML Training Job - 0d29e0d7…` and `- e8e74e1f…` jobs on 07-07, 08-06, 09-05, 10-05 (`global/sysauto_script`) | 4 |
| Same, plus **per new incident**: business rule `ITSM - Assign incident to cluster` (async, on every incident insert) calls `AssignIncidentToClusterSubFlow` → `GAFUtils.updateExistingClusters` | Each incident insert | `M/sn_itsm_gen_ai/sys_script/itsm-assign-incident-to-cluster--df16af74…yaml` | continuous |
| **ITSM Interaction dashboard** (interactions) | Every ~30 days from 2026-10-22 | `M/global/sn_gaf_sysauto_script/gaf-run-offline-flow--c738789e…yaml` (group skill `bbf5bfb3…`, topic skill `GAF ITSM Interaction Dashboard topics`) | 1 |
| Generic **GAF ITSM** and **GAF CSM** offline flows | Every 90 days from 2026-05-18 08:00 | `M/sn_gaf/sn_gaf_sysauto_script/gaf-run-offline-flow--1d2225a8…` (ITSM) and `--8363c408…` (CSM); training jobs on 05-18 and 08-16 | 2 each |
| Knowledge duplicates (does **not** use POV) | When the skill is activated, then on demand | `M/sn_km_gen_ai/sys_script/knowledge-duplicates-activation-trigger--…yaml` | – |
| Other POV users: `Insights Clustering - POV Incident`, `Agent Activity POV` (`sn_icu`, Intent and Activity Analysis), AI Agent Advisor (`sn_agent_miner` POV module), `LEAP Hierarchical POV`, `GAF KB Gap HR pov`, List AI daily job `List GAF group process new records` (`sn_ai_list_exp`) | Various | `M/sn_icu/sn_nowassist_skill_config/*pov*`, `M/sn_agent_miner/sys_module/*-pov--*.content.js` | unknown |

**Most likely source (inferred):** the monthly ITSM Insights dashboard runs (4 runs × ~90 sampled
incidents ≈ 360 POVs; `GAFUtilsHelper.runPovExtractionAndClustering` samples records then calls
`HierarchicalPovCapabilityExecutorUtils.runPov`, `gafutilshelper--…script.js:869`), with topics
per cluster. To confirm with one read-only query: `sys_generative_ai_log` where
`definition.capability = Hierarchical capability (POV)`, grouped by day and by
`skill_config` / `created_by`. Peaks on 07-07, 08-06, 09-05, 10-05 confirm it.

**Why it matters.** The output (incident clusters, topics, action strategies) feeds a dashboard and
the `Incident cluster summary` skill (in product), which had **0 calls**. Every month the instance pays
for ~90 POVs and ~8 topics that nobody reads. Either put this in front of a service-delivery manager
(see 3.1) or switch the schedule off.

---

## 1. Knowledge

### 1.1 KB generation from a resolved task (Generate Knowledge Article)
- **Kind / where:** skill; SOW incident form action "Generate knowledge article"; scope `sn_itsm_gen_ai` (skill `KB generation`), capability `Generate Knowledge Article` in `sn_km_gen_ai`. Also used inside the `Wrap-up and resolve incident` workflow (C7) and the `KB content creation AI agent`.
- **State on everis2:** active, in product. 5 calls in 180 days. Provider: Anthropic `claude-haiku-4-5`, orchestrated by Azure OpenAI `gpt-5.4` (P1-1 README row 6). Language picker on (`sn_km_gen_ai.enable_kb_gen_ai_language_picker=true`). Tested end to end: INC0025193 → KB0010015 (draft, 206 words, English).
- **Persona and business problem:** L1/L2 analyst and knowledge manager. Fixes are solved again and again because nobody writes the article. Daily.
- **Business logic to enable it:** trigger on resolve (manual first, later the `Wrap-up and resolve incident` workflow); inputs: short description, description, work notes, resolution notes, CI, category; output: draft `kb_knowledge` in the right KB, `source` task linked; human checkpoint: knowledge review workflow (draft → review → publish). Target L2 now, L3 (auto-draft on close with manager review) in P3-8.
- **Tweaks to make it useful:**
  - Default target KB per assignment group, not one KB for all (inferred: today the user picks).
  - Copy the skill in Skill Kit as `AIT KB generation` with a fixed template (Symptoms / Cause / Resolution / Applies to) in the client's tone; add CI and service as inputs.
  - Language: generate in the **caller's** language, not the analyst's; set personas' preferred language (gaps.md G1). Use the language picker in the demo to create the Spanish version.
  - Decide the provider (gaps.md G8): it is the only knowledge skill on Anthropic.
  - Data: write real resolution work notes in the demo scripts (gaps.md G3), or the article invents steps.
- **Validation test:** SOW → open a resolved incident with clear work notes → "Generate knowledge article" → choose KB "IT" and language "Spanish" → expect a draft with the four sections in Spanish, `source` = the incident, state Draft; open it in Knowledge Center and submit for review.
- **Value / effort:** High / Low. Works today; tweaks are configuration and demo data.

### 1.2 KB content creation AI agent
- **Kind / where:** AI agent (`sn_km_gen_ai`), no use case of its own; called from chat (Now Assist panel) or other workflows.
- **State on everis2:** agent ON, template. No executions recorded.
- **Persona and business problem:** knowledge manager who wants an article "about X" from several sources, not one ticket.
- **Business logic to enable it:** on request in the panel; it lists writable KBs, drafts, saves as draft. Human checkpoint: review workflow. Target L2.
- **Tweaks:** restrict writable KBs through user criteria so it cannot write into HR or CSM bases; add the `[KM] Multi-task Article Generation` search app (`M/sn_km_gen_ai/sys_search_context_config/km-multi-task-article-generation--…yaml`) to its tools so it can build one article from several incidents.
- **Validation test:** Now Assist panel → "Write a knowledge article about resetting MFA on a new phone using similar resolved incidents" → expect a draft in a writable IT KB with sources.
- **Value / effort:** Med / Low.

### 1.3 Knowledge duplicates and merge (KB content consolidation AI agent)
- **Kind / where:** GAF pipeline (skills `Knowledge duplicates grouping/topic/action strategy`) + agent `KB content consolidation AI agent` + actions `Identify duplicate articles`, `Merge duplicate articles`; Knowledge Center; scope `sn_km_gen_ai`.
- **State on everis2:** grouping/topic/action ON (not in product); `Identify duplicate articles` and `Merge duplicate articles` **OFF**; `sn_km_gen_ai.auto_merge.enable=false`, threshold 70, revert window 5 days. 0 calls. Clusters land in `kb_duplicates_cluster` / `kb_duplicate_articles` (`M/sn_km_gen_ai/sysevent_script_action/populate-duplicate-articles--…yaml`).
- **Persona and business problem:** knowledge manager; duplicate and contradicting articles make search and Q&A worse. Monthly.
- **Business logic to enable it:** activate `Identify duplicate articles` (its status update fires `Knowledge duplicates activation trigger`, which starts the GAF job); review clusters in Knowledge Center; merge with `Merge duplicate articles`; retire the losers. Human checkpoint: merge approval. Target L2; auto-merge (L3) only above a confidence threshold and with the 5-day revert.
- **Tweaks:** needs data: 44 published articles is too few for clusters. Load 150+ articles with deliberate near-duplicates (EN + ES) in P0-5. Keep auto-merge off for the demo; show the cluster and the merge preview.
- **Validation test:** after loading duplicates, Now Assist Admin → activate `Identify duplicate articles` → wait for the GAF job (`sn_gaf_job_tracker` state `offline_job_complete`) → Knowledge Center → Duplicates → expect clusters like "VPN on macOS" with 2–3 articles → Merge → expect a merged draft and the others marked outdated.
- **Value / effort:** High / Med. Strong governance story; needs seeded data.

### 1.4 Knowledge gaps (ITSM)
- **Kind / where:** GAF pipeline `Knowledge gaps identification (ITSM)`, `Knowledge gap grouping/topic/action strategy`; Knowledge Center; `sn_km_gen_ai`.
- **State on everis2:** all **OFF**. Business rule `Knowledge Gaps Capability Activation` and event script `Populate knowledge gaps (ITSM)` ready.
- **Persona and business problem:** knowledge manager / problem manager: "which recurring incidents have no article?" Monthly.
- **Business logic to enable it:** activate the four skills; the job clusters resolved incidents without `kb_knowledge` links and proposes topics; each gap → "Generate article" (1.1). Human checkpoint: manager chooses gaps. Target L2.
- **Tweaks:** needs 6 months of resolved incidents with resolution notes (P0-5). Pair with 1.1 so a gap becomes a draft in one click. Spanish incidents should create Spanish gaps.
- **Validation test:** activate the four skills → wait for job → Knowledge Center → Knowledge gaps → expect topics such as "Outlook sync" with incident counts → "Create article" → draft created.
- **Value / effort:** High / Med. Best "closed loop" demo in this domain; data-dependent.

### 1.5 Knowledge Center, Article Optimization and KB health score
- **Kind / where:** Knowledge Center workspace (`sn_km_center`); scheduled scans; skill `Article Optimization recommendations`.
- **State on everis2:** `sn_km_center.kb_health_score.enabled=true`; weekly `Article Health Score`, monthly `Article Optimization - AI` and `- Scripted` jobs active (`M/sn_km_center/sysauto_kb_assist_job/`); 7 scans (length, readability, bad links, alt tags, H1, title relevancy). But the **AI skill `Article Optimization recommendations` is inactive** (false/true), so the monthly AI scan has nothing to call (inferred). `sn_km_center.glide.knowman.enable=false`: Knowledge Center is not the default knowledge UI.
- **Persona and business problem:** knowledge manager; article quality, readability and broken links. Weekly.
- **Business logic:** health score weekly → AI recommendations per article ("shorten", "add steps") → author accepts. Target L1.
- **Tweaks:** activate `Article Optimization recommendations`; make Knowledge Center the default (`sn_km_center.glide.knowman.enable=true`) for knowledge managers; tune `reading_ease.minimum_score` (60) for Spanish text (inferred: Flesch scores differ by language).
- **Validation test:** activate the skill → run `Article Optimization - AI` on demand → Knowledge Center → an article → expect a health score and AI recommendations.
- **Value / effort:** Med / Low.

### 1.6 Knowledge Content Recommendation
- **Kind / where:** skill, in product (`sn_km_gen_ai`), suggestions while authoring.
- **State:** active, in product; 0 calls.
- **Use / test:** Knowledge Center → new article → expect suggested structure and content. Value Low / Effort Low. Show only inside 1.1/1.3 demos.

### 1.7 KB summarization (alerts)
- `KB Summarization Skill` (`sn_alert_gen_ai`), 7 calls: summarizes KB articles attached to alerts. Covered by the observability domain.

---

## 2. Search, Q&A, knowledge graph and web search

### 2.1 Now Assist in AI Search: synthesized answers (Multi-context Synthesized QnA, "Otto summary")
- **Kind / where:** skill behind the AI Search genius result `ServiceNow Otto summary` (`088c73a5…`), capability `Multi-context Synthesized QnA` (`M/sn_ais_assist/sys_one_extend_capability/multi-context-synthesized-qna--…yaml`). Surfaces: Now Assist (Otto) panel, Virtual Agent, portals, Next Experience global search.
- **State on everis2:** 16 calls (synthesized QnA), 7 (QnA), 47 (BGE reranker). The Otto summary genius result is attached only to the **Otto panel** profile (`61cf241a…`) and **Otto for Virtual Agent** profile (`d67e94c9…`) (`M/global/ais_search_profile_ais_genius_result_configuration_m2m/`). The **Service Portal / VA default** profile (`bd568e85…`) has only `Catalog Item` and classic `Q&A`; the **ESC portal** profile (`fd6491cb…`) has `Catalog Item`, `People` (inactive) and `Q&A`. **Semantic and hybrid search are off** on every portal and Knowledge Center search app; only the Otto panel and email KB retrieval have semantic on (`M/*/sys_search_context_config/*.yaml`, `enable_semantic_search`). `glide.ais.query.hybrid_search_allowed_origins=portal,mobile` is set but no portal app enables it.
- **Persona and business problem:** employee self-service; finds a list of links instead of an answer, raises a ticket. Many times a day.
- **Business logic to enable it:** on search in ESC and in VA: retrieve top KB/catalog chunks → synthesized answer with citations → "Was this helpful?" → if not, offer "create incident" pre-filled. Human checkpoint: none (answers cite approved knowledge only). Target L2 now, L4 deflection in P4 (A5).
- **Tweaks:**
  - Add the `ServiceNow Otto summary` genius result to the ESC and Service Portal profiles; enable semantic + hybrid search on those search applications.
  - Index Spanish articles and set `glide.ais.translate.enable_global_language_fallback` deliberately (now false: Spanish users only see Spanish content, and there is none).
  - Restrict sources to published IT KBs plus catalog; exclude HR KBs for IT demos.
  - Turn on search feedback reporting; track deflection with AI Analytics (2.6).
- **Validation test:** ESC portal → search "no puedo conectar a la VPN" → expect a synthesized Spanish answer with 1–3 cited articles above the result list; panel: "How do I reset my MFA?" → same with citations.
- **Value / effort:** High / Low-Med. Biggest employee-facing gain; mostly configuration plus Spanish knowledge.

### 2.2 Now Assist Q&A and AI Search in Virtual Agent
- **Kind / where:** skill `Now Assist Q&A` (`sn_nava_config`, active, in product), topics `Now Assist - AI Search` (setup topic), `AI Search - Fallback`, `Run AI Search`, `Search Fallback Topic.`; `com.glide.cs.gen_ai.enable_mid_topic_ai_search=true`.
- **State:** active; few calls (QnA 7, ConversationRouter 4, VA Input Response Generation 11).
- **Persona / problem:** employee in chat; same as 2.1.
- **Business logic:** every unmatched utterance → AI Search → Q&A answer → "did that help?" → create incident with the conversation transcript. Target L2, then L4 deflection (A5).
- **Tweaks:** the Otto-for-VA profile already has hybrid search on; switch on VA dynamic translation (`com.glide.cs.dynamic.translation.enable.virtual_agent=false` today) so Polish/Portuguese users get answers from English articles; set `com.glide.cs.llm.default.Language`.
- **Validation test:** ESC → chat → "Outlook no sincroniza" → expect an answer with sources, then "No" → offer to create an incident with the summary pre-filled.
- **Value / effort:** High / Low.

### 2.3 Knowledge graph answers (TextToResult)
- **Kind / where:** capability `TextToResult` (`M/sn_kg/sys_one_extend_capability/texttoresult--…yaml`): natural language → records through the Enterprise knowledge graph. Used in VA (`sn_vad_genai.knowledge_graph.enabled=true`, `…now_assist.search.user_knowledge_graph.enabled=true`), catalog (`sn_now_assist_cr.enable_knowledge_graph=true`) and AI Search NLQ (`sn_ais_assist.enable_knowledge_graph_nlq=true`, genius result `NLQ`).
- **State:** active; **63 calls**, the most-used capability in this domain.
- **Persona / problem:** employee or agent asking about "my" things: "what laptop do I have?", "who is my manager?", "open incidents for SAP". Daily.
- **Business logic:** read-only lookups scoped to the user's ACLs. Target L2/L4 (read-only).
- **Tweaks:** add tag tables (`sn_kg_tag_table`) for `cmdb_ci_computer` assigned_to, `sc_req_item`, `incident` caller; enable `sn_kg.description_generation.enable.cmdb_rel_ci` so it can answer "what depends on X" (inferred: off by default); needs CI data (G2).
- **Validation test:** VA as an ESS user → "¿qué portátil tengo asignado?" → expect the asset name and serial.
- **Value / effort:** Med / Low. Already used; cheap to extend.

### 2.4 Web search answers (Perplexity) and Web research agent
- **Kind / where:** skill `Websearch AI search answers` (`sn_ai_websearch`), provider mapping `Perplexity AI Websearch` (Perplexity subflow), also Google/ScrapingBee/Crawlbase subflows; topic `Now Assist - Web Search` and `Web search fallback`; agent `Web research and recommendation AI agent` (used by Next action recommendation).
- **State:** skill active, not in product; capability `Web Search` active, `Web Search APIs` and `QnA` (websearch) inactive; `sn_ai_websearch.perplexity_model_name` set by admin 2025-07. **0 calls**: no `Websearch` capability in the usage log. A connection credential is probably missing (inferred; credentials were not read).
- **Persona / problem:** L2 analyst on vendor issues (error codes, Microsoft/Zscaler outages) not in the KB.
- **Business logic:** only when internal knowledge has no answer; answer clearly labelled "from the web" with links; never shown to employees by default. Target L1.
- **Tweaks:** configure the Perplexity connection alias; restrict to agents (role `itil`), not ESC; add an allow-list of vendor domains (inferred: supported by the Google subflow inputs).
- **Validation test:** panel as `itil` → "What does Outlook error 0x8004010F mean?" → expect an answer with web citations marked as external.
- **Value / effort:** Med / Med (credential and governance decision).

### 2.5 Plumbing (one line each)
- `RAG Query Rewrite`, `RAG Reranker`, `BGE Reranker`, `Generic Reranker`, `Query Rewriting`, `AIS Dynamic Translation`, `ConversationRouter`: internal steps of 2.1/2.2. Keep on.
- `Search Profile Identification` (`sn_ai_search_admin`), `AI Search Configuration Agent`: admin set-up helpers. Use once to set up 2.1.
- `Popularity Signal LLM Labeling Tool`, `Synthetic Utterance Generator v2` (off): AI Search tuning; ignore.

### 2.6 AI Analytics Q and A (Now Assist usage and deflection)
- **Kind / where:** agentic workflow `AI Analytics Q and A Workflow` (`sn_na_analytics`), Now Assist panel; dashboards in `sn_na_analytics` (263 dashboard widgets, 112 indicators).
- **State:** ON; 0 executions.
- **Persona / problem:** AI product owner / client sponsor: "is anyone using it, what did it deflect?" Weekly.
- **Business logic:** read-only questions about AI KPIs; weekly summary. Target L2.
- **Tweaks:** usage is near zero (gaps.md G10), so seed usage first; collect AI feedback (G7) so acceptance rates exist.
- **Validation test:** panel → "How many Now Assist skill calls last week by skill?" → expect a number table with a link to the AI Analytics dashboard.
- **Value / effort:** Med / Low. Required for the governance story (F5), not for end users.

---

## 3. Analytics

### 3.1 Now Assist ITSM Insights dashboard (incident clusters, Incident cluster summary)
- **Kind / where:** batch GAF pipeline (section 0) + skills `Incident cluster summary`, `Interaction cluster summary` (in product) on an ITSM insights dashboard; `sn_itsm_gen_ai`.
- **State:** pipelines running monthly (ITSM since 2026-07-07, interactions since 2026-10-22); every new incident is assigned to a cluster; after each run a PA job `[Insights Incident] Historic Data Collection` is launched (`M/sn_itsm_gen_ai/sys_script/itsm-insights-data-collection--…`). `Incident cluster summary` had **0 calls**: nobody looks at it.
- **Persona and business problem:** service-delivery manager / problem manager: "what are we drowning in this month and what should we do about it?" Weekly.
- **Business logic:** monthly clustering → topics → action strategy per cluster (e.g. "create problem", "write KB", "automate"); manager opens a cluster → summary → one click to create a problem (C6) or a KB draft (1.1). Human checkpoint: manager decides. Target L2.
- **Tweaks:** find the dashboard (Platform Analytics, ITSM insights) and add it to the SDM's SOW landing page; run it after P0-5 data load so clusters mean something; schedule weekly in the demo window, monthly at clients; add buttons to create problem/KB from a cluster (Global UI action `AIT -` if not OOB).
- **Validation test:** after data load, run the `GAF - Run Offline Flow` job (sn_itsm_gen_ai) on demand → wait for `sn_gaf_job_tracker` complete → open the ITSM insights dashboard → expect ~10–30 named clusters with counts → open "Outlook sync" → "Summarize" → expect cause and suggested actions.
- **Value / effort:** High / Low. Already paid for; just surface it. This is the B7 core, not the trend agent alone.

### 3.2 Issue trend analysis AI agent ("Analyze task trends")
- **Kind / where:** agentic workflow `Analyze task trends` (`sn_uxc_gen_ai`), copilot, panel or list.
- **State:** agent ON; skill `Analyze Task Trends` OFF (B7 table); 0 executions.
- **Persona / problem:** same as 3.1, ad hoc: "why so many P2s on SAP this week?"
- **Business logic:** user selects a filtered list → agent groups → recurring issues and root causes → recommendations; read-only. Target L2.
- **Tweaks:** activate `Analyze Task Trends`; give it service and CI in the inputs (G2 data); offer it from the list context menu.
- **Validation test:** SOW incident list filtered "last 30 days, category Network" → Now Assist → "Analyze trends" → expect 3–5 recurring issues with counts and recommendations.
- **Value / effort:** Med / Low.

### 3.3 Text to analytics: Data Visualization Generation Agent
- **Kind / where:** agent `Data Visualization Generation Agent` + skill `Data visualization generation` (`sn_text2analytics`), Now Assist panel ("Analytics in NAP"); renders list, pie, bar, score, line etc.
- **State:** active, in product; 0 calls.
- **Persona / problem:** team lead or manager who can't build reports: "show me open P1 and P2 by assignment group as a bar chart".
- **Business logic:** read-only query → chart → "save to dashboard". Target L2.
- **Tweaks:** check ACLs/roles (`sn_text2analytics` role contains); train demo prompts in Spanish; data volume (P0-5).
- **Validation test:** panel → "Muéstrame los incidentes abiertos por prioridad en un gráfico de barras" → expect a bar chart with correct counts (compare with a list filter).
- **Value / effort:** High / Low. Great demo moment; no build.

### 3.4 Analytics query generation and insights (`sn_query_gen`)
- **Kind / where:** skills `Analytics query generation` (+ for indicators), `Analytics insight generation`, `hidden insight`, `follow up generation`; Platform Analytics "ask a question", used by 3.3.
- **State:** active (query gen, insight, follow-up in product); 2 calls. Table config has 31 tables, including `task` with child hierarchy and `sys_user`, `cmdb_ci`, `alm_asset` (`M/sn_query_gen/sn_query_gen_table_config/`), but no table-specific semantic descriptions (`entity_semantic_description` empty).
- **Tweaks:** add explicit configs for `incident`, `change_request`, `problem`, `sc_req_item` with semantic descriptions in Spanish and English (field synonyms "prioridad", "grupo"); this is what makes answers correct.
- **Validation test:** Platform Analytics → "Ask a question" → "average resolution time for P2 incidents last quarter by group" → expect a query and result; follow-up suggestions appear.
- **Value / effort:** Med / Low.

### 3.5 Dashboard summarization and facts (`sn_pa_aia_insights`)
- **Kind / where:** skills `Dashboard Summarization`, `Dashboard Facts Generator`, `Change Summary`, `Dashboard Summarization Skill Config` (in product); Platform Analytics dashboards. Plus `Dashboard and visualization export` (`sn_parexport_genai`).
- **State:** active; 0 calls; planned in P1-4.
- **Persona / problem:** IT manager in a weekly review; reads the dashboard narrative instead of 12 widgets.
- **Business logic:** "Summarize" on a dashboard → narrative + facts + changes since last period; export to PDF/PPT for the meeting. Target L1/L2.
- **Tweaks:** pick one ITSM overview dashboard with populated PA indicators (needs PA collection jobs and 6 months of data); language follows the user.
- **Validation test:** open the ITSM overview dashboard → "Summarize" → expect 5–8 bullets with numbers that match the widgets; "Export" → PDF with summary.
- **Value / effort:** Med / Low.

### 3.6 AI Filter Assist and List AI
- **Kind / where:** `AI Filter Assist` (natural language list filters, in product), `Track List Record Changes`, `List AI - Task Grouping/Topics` (GAF on lists, daily job); `sn_ai_list_exp`.
- **State:** active; 0 calls; the daily List GAF job runs anyway.
- **Use:** analyst types "my team's P2 incidents not updated for 3 days" in the list filter. **Test:** any incident list → AI filter → that sentence → expect the right condition builder query.
- **Value / effort:** Med / Low. Cheap daily productivity win; good in every demo.

### 3.7 ServiceNow AI Lens and AI Desktop Actions
- **Kind / where:** skill `ServiceNow AI Lens` (`sn_ai_lens`, in product) and `AI Desktop Actions` (`sn_desktop_agents`); desktop/browser client that reads the user's screen to explain it or create a record.
- **State:** active; 2 calls.
- **Persona / problem:** employee with an error on screen in any app: "create a ticket from this" without typing.
- **Business logic:** capture → extract the error → create incident with screenshot and summary. Human checkpoint: user confirms. Target L2.
- **Tweaks:** needs the AI Lens client installed on the demo laptop; route created incidents through triage (B1).
- **Validation test:** with AI Lens, open an app error dialog → "Create incident" → expect an incident with the error text, app name and screenshot.
- **Value / effort:** Med / Med (client install). Strong visual demo, joins A8 "picture to ticket".

---

## 4. Documents

### 4.1 Content insights AI agent and document extraction
- **Kind / where:** agent `Content insights AI agent` (`sn_docintel_gen_ai`) with QnA, key information extraction, summarization; skills `Document extraction`, `Extract information from documents`, `Multimodal Chat` (active, not in product); VA attachments Q&A (`com.glide.cs.doc_qna.va_attachment.max_attachments=3`); used by `Process images for new tasks` (A8).
- **State:** ON; 0 calls in this log.
- **Persona / problem:** agent receives a PDF quote, invoice, vendor RCA or screenshot on a ticket and has to retype it.
- **Business logic:** on attachment added to an incident/request → extract key fields (vendor, amount, error code) → propose field values + work note. Human checkpoint: analyst accepts. Target L2, L3 for a fixed document type.
- **Tweaks:** create a document task definition for one IT document type (vendor incident report or hardware quote) via `sn_docintel_gen_ai.default_qna_task_definition`; `document_length_threshold=10000` fine for demos.
- **Validation test:** attach a vendor RCA PDF to an incident → panel "Summarize the attachment and extract root cause and affected service" → expect a summary with citations to pages.
- **Value / effort:** Med / Med. Covered by candidate "Document-driven requests".

### 4.2 Smart Documents (document viewer)
- **Kind / where:** agent `Smart Documents Agent` and skill `Smart Documents` (`sn_doc_gen_ai`, in product); only in the ServiceNow Document Viewer: summary, FAQ, redaction (`Get Sensitive Content`).
- **State:** active; 0 calls.
- **Use:** contracts/policies opened in Document Viewer → summary, FAQ, redact PII before sharing. **Test:** open a policy PDF in Document Viewer → "Generate FAQ" → expect Q&A pairs; "Redact" → PII highlighted.
- **Value / effort:** Low (for IT) / Low. Show only for change policy documents (links to the `Change quality assessor using change policy documents` agent).

---

## 5. Surveys and experience

### 5.1 Survey Analysis AI agent ("Identify ways to improve service")
- **Kind / where:** agentic workflow `Identify ways to improve service` (`sn_uxc_gen_ai`), skill `Survey analysis` (active, not in product); panel.
- **State:** ON; 0 executions.
- **Persona / problem:** service owner reads hundreds of survey comments once a quarter, if ever.
- **Business logic:** "analyse satisfaction for last quarter" → trends, top complaints, prioritised recommendations → optionally create improvement tasks. Target L2.
- **Tweaks:** needs survey data: send the standard incident-closure survey on the demo incidents (`Update Service Offering Subscribers, Send Surveys…` job is active; SMTP is off, so fill responses with a script in P0-5). Include free-text comments in Spanish to show multilingual analysis.
- **Validation test:** panel → "Analiza las encuestas de satisfacción del último trimestre para Service Desk" → expect CSAT trend, top 3 complaint themes with example comments, 3 recommendations.
- **Value / effort:** Med / Med (data).

### 5.2 Survey response suggestion ("Propose survey responses")
- Agents `Survey filling data collection` + `Survey response suggestion` (ON), skill active not in product. Suggests answers to a survey from the record (useful for internal assessments, e.g. post-incident or vendor surveys, not for customer CSAT). Value Low / Effort Low. Ignore unless the client runs internal assessments.

### 5.3 Sentiment and Survey-LLM topics
- Record Sentiment Analysis (146 calls) belongs to the incident domain. VA topics `Survey-LLM`, `_postchat_survey_llm_`, `_send_survey_llm_` exist and are active: conversational post-chat survey. **Test:** finish a VA chat → expect an LLM-driven 1-question survey. Value Med / Effort Low (closes the feedback loop G7 for chat).

---

## 6. Translation and multilingual

### 6.1 Dynamic Translation for Now Assist and chat
- **Kind / where:** platform (`sn_dt`, `sn_generative_ai`), agents `Multilingual and Policy Settings Manager` (Translation Settings, Language Configuration).
- **State:** Dynamic Translation plugins installed; translator configurations: `ServiceNow` active, `Microsoft Azure OEM` active, `Microsoft` (BYO key) inactive, and **none is marked default provider or default detection** (`M/sn_dt/sn_dt_translator_configuration/*.yaml`, `M/sn_ms_oem/…`). `sn_generative_ai.disable_dynamic_translation=true`, `sn_generative_ai.enable_native_translation=true`, `append_lang_in_prompt=true`; VA translation off. Result: LLM answers follow the user's language only (P1-1 finding 3).
- **Persona / problem:** Spanish, Polish, Portuguese employees and analysts; English-only knowledge.
- **Business logic:** native LLM output in the user's language for skills; dynamic translation for chat (both directions) and for KB content in AI Search. Target L1 (A6).
- **Tweaks:** set `ServiceNow` (or Azure OEM) as default provider and default detection; enable VA and agent-chat translation; use the `Multilingual and Policy Settings Manager` agent to configure ES/EN/PL/PT (P1-3); give each persona a preferred language.
- **Validation test:** as a Polish-language ESS user → VA "Nie mogę się zalogować do VPN" → expect a Polish reply with content from an English article; agent sees the English translation in Agent Chat.
- **Value / effort:** High / Low. Prerequisite for every other demo in Spanish.

---

## 7. Other in-scope items (one line each)

- **Error Framework AI** (`sn_ef_gen_ai`, `Error Framework AI Insights Skill`, workflow `Error Analysis and Remediation Workflow`, 2 executions): explains platform error codes and runs pre-set remediations for admins. Value Med for the platform team, not for end users. Test: panel as admin → "Explain error framework error X" on a failing integration.
- **Moveworks skills on global** (`Brief Me`, `Write email`, `Search (knowledge and forms search)`, `Record Lookup`, `Translate text` and 10 more): metering/entitlement records for "ServiceNow Otto Chat Integration (built on Moveworks)" (`sn_ex_mw_chat_int`); no capability definitions on the instance and the webchat bot identifier is empty, so they run only in a connected Moveworks tenant (inferred). 0 calls. Ignore unless a Moveworks tenant is part of the demo.
- **Goal insights generation** (1 call), SPM doc generation: SPM domain, out of scope.
- **NAP translation, Keyboard Shortcut Suggestions** (`sn_kbs_genai`): noise.

---

## 8. Ranked top 15 (value ÷ effort)

| # | Capability | Value | Effort | Why now |
|---|---|---|---|---|
| 1 | 6.1 Translation defaults + VA translation | High | Low | Unblocks every Spanish/Polish demo; config only |
| 2 | 2.1 Otto summary genius + semantic/hybrid on ESC and portal | High | Low | Turns search into answers where employees are |
| 3 | 3.1 Surface the ITSM Insights dashboard | High | Low | Already running and paid for monthly; 0 views |
| 4 | 1.1 KB generation tuned (template, KB per group, caller language) | High | Low | Works; tweaks make it client-grade |
| 5 | 2.2 Now Assist Q&A in VA | High | Low | Same content as 2.1, chat channel |
| 6 | 3.3 Data Visualization Generation Agent | High | Low | Best "wow" analytics demo, no build |
| 7 | 3.6 AI Filter Assist | Med | Low | Daily analyst win, zero risk |
| 8 | 2.3 Knowledge graph answers (extend tags) | Med | Low | Already the most-used capability here |
| 9 | 3.4 Query generation table semantics | Med | Low | Makes 3.3 and PA questions correct |
| 10 | 3.5 Dashboard summarization | Med | Low | Weekly review story (P1-4) |
| 11 | 3.2 Analyze task trends | Med | Low | Ad-hoc complement to 3.1 |
| 12 | 1.5 Article Optimization AI + Knowledge Center default | Med | Low | Monthly scan already scheduled |
| 13 | 1.4 Knowledge gaps (ITSM) | High | Med | Closed loop incidents → gaps → articles; needs data |
| 14 | 1.3 Knowledge duplicates and merge | High | Med | Governance story; needs seeded duplicates |
| 15 | 2.6 AI Analytics Q and A | Med | Low | Evidence for F5 governance once usage exists |

Next tier: 5.1 Survey Analysis (data), 3.7 AI Lens (client install), 4.1 Content insights, 2.4 Web search (credential decision).

## 9. Switch off or ignore (noise)

- **GAF batch jobs nobody reads**, unless 3.1 is surfaced: `sn_gaf` 90-day `GAF - Run Offline Flow` for **ITSM** and **CSM** (`M/sn_gaf/sn_gaf_sysauto_script/*.yaml`; CSM is irrelevant for an IT demo), the interaction dashboard job (`M/global/sn_gaf_sysauto_script/gaf-run-offline-flow--c738789e…`), and the per-incident `ITSM - Assign incident to cluster` rule. They are the source of most of the 359 POV / 31 Topic calls (inferred).
- GAF HR / KB Gap HR / CSM skill configs (`GAF HR *`, `GAF KB Gap HR *`, `GAF CSM *`), `GAF Pov clustering` (created by a ServiceNow engineer), `GAF Suggested Steps *` (off): not IT.
- Moveworks skills on global (no tenant).
- `Popularity Signal LLM Labeling Tool`, `Synthetic Utterance Generator v2`, `Keyboard Shortcut Suggestions`, `Survey response suggestion` (unless internal assessments), `Smart Documents` (except for change policy documents), `Knowledge Content Recommendation` as a standalone demo.
- Web search shown to employees (keep to agents only).

## 10. New use cases not yet in the strategy repo

1. **Monthly "what are we drowning in" review (insights-to-action).** ITSM Insights clusters (3.1) → cluster summary → one click to problem (C6), KB draft (1.1) or automation backlog (F4). Joins B7, C6 and F4 into one SDM ritual. Already half-running.
2. **Answer-first employee search (ESC).** Synthesized, cited answers in the portal search box (2.1) with "not helpful → incident pre-filled", measured as deflection. The strategy covers VA deflection (A5) but not portal search.
3. **Knowledge closed loop.** Gaps (1.4) → generated drafts in the caller's language (1.1) → duplicates merged (1.3) → health score (1.5) → Q&A quality (2.1). One KPI: share of incidents resolved with an article.
4. **"My stuff" questions through the knowledge graph.** "What laptop do I have / which of my requests are pending / who approves this?" (2.3), read-only L4 in chat and voice.
5. **Self-service reporting for team leads.** Natural-language charts (3.3) + AI filters (3.6) + dashboard narrative (3.5) replaces report requests to the platform team.
6. **Spanish-first knowledge.** Translate the 44 English articles with the KB generation language picker / dynamic translation and publish ES versions; makes every search and Q&A demo work for Spanish users.
7. **Screen-to-ticket with AI Lens** (3.7), as the desktop twin of A8 "picture to ticket".
8. **Vendor document intake.** Vendor RCA or quote attached to an incident/change → extracted into fields and work notes (4.1). (Listed as a candidate in the repo, without the IT document types.)
