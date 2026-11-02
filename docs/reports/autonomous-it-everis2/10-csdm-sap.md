# CSDM model for SAP: from an alert to the business it hurts

**Status: designed and approved by the owner (2 November); not loaded yet.** The owner approved
loading the data on everis2. The Fix Scripts in `build/` are written and pass a syntax check, but
they have not run: the browser had no everis2 session. The design rests on the read-only mirror of
27 October and on the code of the agents.

## Why

The SAP outage in Act 3 already shows alerts that explain themselves: three events are grouped, and
the AI names the kernel change as the likely cause. It does not show **who is hurt**. The SAP
hosts belong to no application service, so:

- the alert names no affected service;
- the impact agents have nothing to follow;
- grouping scene 3.4 has to ask for alerts to be grouped "even when the CIs are not related".

With a CSDM model, the same outage tells a business story. *"Sales orders in Spain are failing
because SAP S/4HANA PRD lost a dialog instance after last night's kernel change. Two employees
have already reported it. The SAP Basis team owns the fix."* The same symptom on the quality
system gets a different answer: *"No business service depends on it; it can wait for office hours."*

## Business application and application service are different things

| | Business application **SAP S/4HANA** | Application service **SAP S/4HANA PRD** / **QAS** |
|---|---|---|
| What it is | The product the company owns: "we use SAP S/4HANA" | One running installation of that product |
| How many | One per product | One per environment |
| What it holds | Owner, vendor, criticality, lifecycle | Hosts, SAP instances, the service map, monitoring |
| Who uses it | Architects and portfolio managers | Operations, Event Management and the AI agents |
| CSDM domain | Design | Build and run (service delivery) |

That is why the model has **two** application services under one business application. Only
production carries business offerings, because no business process runs on the quality system.

## The model

```mermaid
flowchart TB
  BA["Business application<br/><b>SAP S/4HANA</b>"]
  BS["Business service<br/><b>Gestión de pedidos</b>"] --> BO1["Business offering<br/><b>Pedidos de venta - España</b>"]
  BS --> BO2["Business offering<br/><b>Facturación - España</b>"]
  TS["Technology management service<br/><b>SAP Basis</b>"] --> TO1["Technology offering<br/><b>SAP Basis - Producción</b>"]
  TS --> TO2["Technology offering<br/><b>SAP Basis - No productivo</b>"]
  BA -- "Consumes" --> PRD
  BA -- "Consumes" --> QAS
  BO1 -- "Depends on" --> PRD
  BO2 -- "Depends on" --> PRD
  TO1 -- "Contains" --> PRD
  TO2 -- "Contains" --> QAS
  PRD["Application service<br/><b>SAP S/4HANA PRD</b><br/>criticality 1, Production"]
  QAS["Application service<br/><b>SAP S/4HANA QAS</b><br/>criticality 3, QA"]
  PRD -. "service map" .-> LB
  QAS -. "service map" .-> Q
  subgraph MAPP["Members of SAP S/4HANA PRD (12 CIs)"]
    LB["SAP LoadBal01"] --> W["SAP WEB01-04"]
    W --> D0["PRD D00<br/>on SAP AppSRV01"]
    W --> D1["PRD D10<br/>on SAP AppSRV02"]
    D0 --> ASCS["PRD ASCS01<br/>on SAP AppSRV01"]
    D1 --> ASCS
    D0 --> HDB["HDB PRD<br/>on SAP HANADB01"]
    D1 --> HDB
  end
  subgraph MAPQ["Members of SAP S/4HANA QAS (4 CIs)"]
    Q["SAP QASSRV01"] --- QD["QAS D00"] --> QA["QAS ASCS01"]
    QD --> QH["HDQ QAS"]
  end
  CHG["CHG0030111<br/>kernel 7.89 PL 200"] -. "affected service" .-> PRD
```

| Layer | Record | Class | Linked by |
|---|---|---|---|
| Business application | SAP S/4HANA | `cmdb_ci_business_app` | *Consumes::Consumed by* → both application services |
| Business service | Gestión de pedidos | `cmdb_ci_service_business` | Parent of its offerings |
| Business offerings | Pedidos de venta - España, Facturación - España | `service_offering` | *Depends on::Used by* → **PRD only** |
| Technology management service | SAP Basis | `cmdb_ci_service_technical` | Parent of its offerings |
| Technology offerings | SAP Basis - Producción, SAP Basis - No productivo | `service_offering` | *Contains::Contained by* → PRD, QAS respectively |
| Application services | SAP S/4HANA PRD, SAP S/4HANA QAS | `cmdb_ci_service_discovered`, created by the CSDM helper with manual members | Their members make the service maps |
| SAP software | PRD ASCS01, PRD D00, PRD D10, HDB PRD; QAS ASCS01, QAS D00, HDQ QAS | `cmdb_ci_appl_sap_ascs`, `_di`, `_hana_db` | *Runs on::Runs* their host (through the IRE) |
| Hosts | PRD: SAP LoadBal01, SAP WEB01-04, SAP AppSRV01-02 (reused), SAP HANADB01 (new). QAS: SAP QASSRV01 (new) | as on the instance; new ones `cmdb_ci_linux_server` | *Depends on::Used by*, top-down |

Every record has the support, managing and change group **DEMO.PI.SAP** and an owner. PRD records
are Production with criticality 1; QAS records are QA with criticality 3.

The relationship types are not a choice. They are the ones ServiceNow's own CSDM helper
(`CSDMAppServiceHelper`) creates, and the only ones the impact agent follows:

- in `EmAiaAlertImpactUtils.getCsdmRelationsForServiceInstances`, *Depends on* or *Contains*;
- the parent class must be exactly `service_offering`, `cmdb_ci_service_business` or
  `cmdb_ci_service_technical`.

The impact agent does not read the business application. The business application is there for
CSDM completeness and for the map in scene 3.0.

## What each piece gives the agents

| Agent (everis2) | Reads | Needs from the model | Works on this data |
|---|---|---|---|
| Manage alerts AI agent (autonomous, already in scene 3.1) | Alert CI, relationships between the grouped CIs, impacted services, changes on the CI or the service | Service map, CHG0030111 → service | Yes: it gains "affected service" in its insight |
| Analyze alert impact team (on request, in the panel) | 1. Is the alert eligible. 2. Service instances hit (impact graph). 3. Offerings and services above them, with criticality and owner. 4. Incidents and cases on them, filed by people within two hours of the alert | All of it, plus the user reports | Yes, once the impact graph has rows (see risks) |
| Alert Automation AI agent (scene 3.4) | Alerts, grouping automations | Optional: "group alerts of the same service" | Yes |
| CSDM Business Application to Infrastructure specialist | Business app and application services with matching names | Nothing: the build already links them | Not used: it is off, and it links with *Uses::Used by*, which is not CSDM |
| Service Map Creation, Analyze Potential Impact (change) | Discovery, running processes, traffic | Discovery data | No: there is no Discovery on everis2 |
| SLO Gap, SLO Creator, Reliability Domain | SLO tables | The SLO data app | No: the app is missing |

## The storyline: Act 3 with the business in it

The scenes keep the current route and add three beats (3.0, 3.1b, 3.1c). They take about 6
minutes more.

| # | Where | Do | Show | Agent |
|---|---|---|---|---|
| **3.0** | CMDB Workspace or the service map, admin | Open the business application SAP S/4HANA, then SAP S/4HANA PRD | One product, two installations; from "Gestión de pedidos" down to the HANA host. *"An agent is only as good as the map it reads"* | None (the foundation) |
| 3.1 | SOW, newest SAP alert group | Open the group, then the primary alert | As today, plus the affected service SAP S/4HANA PRD in the alert and the insight; CHG0030111 also lists the service | Manage alerts (autonomous) |
| **3.1b** | SOW, same alert, Otto panel | "Analiza el impacto de esta alerta" | Four work notes: SAP S/4HANA PRD is hit; Pedidos de venta and Facturación - España (criticality 1, owner) and SAP Basis - Producción; two employees reported it 4 and 7 minutes after the alert ("error de actualización V1") | Analyze alert impact team |
| **3.1c** | SOW, the QAS alert on SAP QASSRV01 | Same question | The same symptom, but only SAP S/4HANA QAS and SAP Basis - No productivo: no business offering, no users. *"Same alert, different priority, because the CMDB knows the difference"* | Analyze alert impact team |
| 3.1d | SOW, PRD alert | Quick incident | The incident carries the CI, the group and the analysis (B7) | B7 business rule |
| 3.2-3.4 | as today | On call, runbook, automation | Scene 3.4 can now ask for "alerts of the SAP S/4HANA PRD service" | as today |

The message moves the audience from "the AI read the alert" to "the AI knows the business
behind the alert". The CMDB is what makes the difference, which also sets up the client's CMDB
work.

## How to load it

All scripts run in Global scope as admin (System Definition → Fix Scripts → New, paste, Run Fix
Script). Use update set `AIT-CSDM-SAP`; the CIs are data, so it captures nothing, but the Fix
Scripts themselves go into it.

| Step | When | Script | Result |
|---|---|---|---|
| 0 | Once | [AIT demo groups and on-call](build/demo-groups-on-call-fix-script.js) | 14 fictitious Spanish users, some in two groups. Each DEMO.PI group gets 3 to 5 members, a manager, and a "24x7" rota: Primary rotates weekly through the engineers, Secondary is the manager. A group that already has a rota keeps it. The script ends by asking the on-call engine who is on call in each group |
| 1 | Once | [AIT CSDM SAP 1 - build](build/csdm-sap-1-build-fix-script.js) | The model above. It finds records by business key, creates the missing ones and fills only empty fields. Safe to run again |
| 2 | Before each demo, after step 3 | [AIT CSDM SAP 2 - check](build/csdm-sap-2-check-fix-script.js) | Read-only. One `OK` or `CHECK` line per link the agents follow, for PRD and QAS |
| 3 | Each demo, right after "AIT demo 1 - prepare" | [AIT CSDM SAP 3 - demo prep](build/csdm-sap-3-demo-prep-fix-script.js) | The QAS event, and two employee incidents on "Pedidos de venta - España", timed 4 and 7 minutes after the new PRD alert |
| 9 | To remove it | [AIT CSDM SAP 9 - revert](build/csdm-sap-9-revert-fix-script.js) | Lists what step 1 made; deletes it with `DRY_RUN = false` |

Then rehearse 3.1b and 3.1c once and record their answer keys in the quality plan, as for the
other scenes.

## Not verified yet

These were not checked against the live data, because the browser had no session:

1. **The SAP demo hosts exist under these names**, and each host's class is not yet known. The
   build prints a `CHECK` line for any missing host.
2. **The impact graph fills for a hand-built service.** This is the key risk. The Event
   Management impact engine builds `em_impact_graph` from the service map, and the Alert Crawler
   copies it to `sn_em_ai_alert_services`. Step 2 checks both. If they stay empty, the fallback
   is to open the map once and save it, which recalculates it.
3. **The choice labels**: "Production", "QA" (or "Test"), "1 - most critical", "3 - less
   critical", "Business Service", "Technical Service", and "OK" for service severity. The scripts
   look them up by label and print a `CHECK` line when one is missing.
4. **The impact team can be started from the panel.** Its trigger is off, which is expected,
   because it runs on request.
5. **The two callers exist** (`abel.tuter`, `adela.cervantsz`).
6. **The QAS event binds to SAP QASSRV01.** It names the host as its node, like the PRD events.

## Decisions

| # | Decision | Outcome |
|---|---|---|
| D1 | Names: SIDs `PRD` and `QAS`, "Gestión de pedidos", "SAP Basis", Spanish offerings | Proposed: Spanish for the business layer, SAP's own terms for the technical one |
| D2 | Load the data on everis2 (CMDB data tagged `[AIT-DEMO]`, with a revert script) | **Approved by the owner, 2 November** |
| D3 | Two application services (PRD and QAS) under one business application | **Approved by the owner, 2 November** |
| D4 | Activate the CSDM Business Application to Infrastructure agent | Recommended no: it creates a non-CSDM relationship, and the build already makes the right one |
| D5 | Extend B7 so the quick incident also carries the business offering | Later: small, and only after 3.1b works |
| D6 | The 384 reconciliation rules at priority 9999 (see the CMDB assessment) | Leave them for the demo; don't show them as client practice |
