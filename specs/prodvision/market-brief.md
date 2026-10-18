# Market brief: ServiceNow developer and platform tooling (October 2026)

- Date: 2026-10-16
- Method: web research. Key pages were read in full (marked *read*); others are known from
  search summaries only. Dates are publication or documentation dates.
- Marks: *weak* is a low-quality or unconfirmed source; *guess* is inference, not a finding.
- Used by: [`design.md`](design.md), section 4.

## 1. ServiceNow's own tooling

- **MCP in the platform.** Zurich added an MCP Client in AI Agent Studio and an MCP Server Console
  that exposes Now Assist skills as MCP tools. A Store app supports MCP 2025-06-18 on Yokohama P6+
  and Zurich P1+ (2025).
  - https://www.servicenow.com/docs/r/SRy58xeijUUqttfwLgfrHQ/3~884tN0HPm0U5wGXEV9Nw
  - https://store.servicenow.com/store/app/5d8e6497977f26d03b7e30d71153af15
- **Action Fabric** (2026-05-05, *read*). A generally available MCP server through which any
  outside agent runs governed workflows, playbooks, approvals and catalog actions. It has
  role-based tool packages, including one for app development. It is included in every Now Assist
  and AI Native SKU, on consumption pricing, with Anthropic as the first design partner.
  - https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-opens-its-full-system-of-action-to-every-AI-Agent-in-the-enterprise/default.aspx
- **Out-of-box MCP servers** for ITSM, ITOM, CMDB and SPM (GA 2026-09-10, *read*). "The AI
  client decides which tool to call. ServiceNow controls what that tool can see and do." On a
  change-management benchmark, Claude cost about 52% less than through the raw Table API. These
  servers are operational, not for developers or metadata.
  - https://www.servicenow.com/community/itsm-blog/servicenow-launches-out-of-the-box-mcp-servers-for-claude/ba-p/3596376
- **Anthropic partnership** (2026-01-28). Claude is Build Agent's default model; Build Agent is
  integrated with Claude Code.
  - https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-and-Anthropic-partner-to-help-customers-build-AI-powered-applications-accelerate-time-to-value-and-apply-trusted-AI-to-critical-industries/default.aspx
- **Build Agent** (2026-05-06, *read*). Generally available in Studio. Through the SDK, its skills
  reach Cursor, Windsurf, Claude Code and Copilot. It now covers "the entire platform, including
  out-of-the-box applications". App Engine Management Center (AEMC) is free for every customer and
  enforces deployment approvals. A freemium tier was planned for Q3 2026. The announcement doesn't
  mention git or update sets.
  - https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-Build-Agent-now-works-inside-every-major-AI-coding-tool-governed-by-default/default.aspx
- **Documented limits.** Build Agent handles apps of fewer than 20 tables. The SDK has "limited
  platform metadata manipulation compared to Studio" (2026).
  - https://www.servicenow.com/docs/r/application-development/vibe-coding-tool-comparison.html
- **ServiceNow SDK and Fluent.** 4.0 shipped with Zurich (doc dated 2025-07-31). Later versions
  added Flow, Catalog, SLA, Dashboard, Workspace, Import Set and UI Policy APIs, for about 64
  metadata types in all. The SDK downloads an app's metadata as XML and converts it to Fluent;
  metadata snapshots and UX assets stay as XML.
  - https://www.servicenow.com/docs/r/zurich/release-notes/servicenow-sdk-rn.html
- **SDK AI skills.** From 4.6, a `now-sdk` skill for Claude Code, Copilot, Cursor, Codex, Windsurf
  and Kiro (`/plugin install servicenow-sdk@claude-plugins-official`). From 4.8, `query` for live
  records, sys_ids, schema, choices and roles. The SDK writes and deploys; no MCP server was found
  in it.
  - https://github.com/ServiceNow/sdk (*read*; release dates not visible)
- **Otto for Creator, September 2026 store release** (*read*):
  - the ServiceNow IDE is merged into Studio;
  - Build Agent upgrades itself monthly;
  - parameterized ATF tests and suites in Fluent;
  - domain separation in Fluent (`sys_domain`);
  - a Build Agent trial is on by default in the Brazil early-access release (2026-09-24): 100
    interactions per 30 days.
  - https://www.servicenow.com/community/servicenow-otto-for-creator/what-s-new-in-servicenow-otto-for-creator-brazil-ea-release/ta-p/3596068
- **Autonomous Engineer** (2026-09-08), on the separate AI Workflow Factory SKU. It "reads your
  instance", plans work items with acceptance criteria, builds them in parallel and generates ATF
  tests.
  - https://www.servicenow.com/docs/r/application-development/autonomous-engineer.html
- **Brazil release**, GA expected November 2026:
  - Developer Sandboxes: pooled, refreshed every 24 hours, with update sets set up automatically;
  - a Flow Troubleshooting Agent.
  - https://nowben.com/top-5-brazil-release-features-for-servicenow-developers/ (2026-10-09)
- **ServiceNow IDE**: VS Code for the Web on the instance, with git source control for scoped
  apps.
  - https://www.servicenow.com/docs/r/guL1zqmJkV9eywMq_6qu~w/RDnmHdwZP1E3Fn05Z4fkjw
- **Instance Scan** (Australia, 2026-03-12): parallel scans, a `scan_check_writer` role, access
  from the IDE. It is on by default.
  - https://www.servicenow.com/docs/r/release-notes/instance-scan-rn.html
- **Impact.** HealthScan and the Scan Engine estimate technical debt in developer-hours. Proactive
  Code Check, which scans update sets on non-production instances, is being prepared for
  deprecation from Impact 6.0.8. List prices, according to a negotiation advisor: Guided about 10%
  of the subscription, Advanced about 20%, Total about 30%.
  - https://www.servicenow.com/docs/r/zurich/impact/proactive-code-check.html
  - https://upperedge.com/servicenow/servicenow-impact-the-hidden-costs-no-one-is-talking-about-and-how-to-negotiate-them-down/
- **Upgrades.** Upgrade Preview predicts skipped records and has AI summaries (2026-03-12). No
  agent dedicated to resolving skipped records was found.
  - https://www.servicenow.com/docs/r/UrSRFFKWBbfQBgoRlt~ltw/pBfTjr3w_URzhTd204fipA
- **ATF.** The ATF Test Generator and Cloud Runner (headless runs hosted by ServiceNow) are in the
  Upgrade Console. Now Assist's ATF generation creates new tests but can't update or delete
  existing ones.
  - https://www.servicenow.com/docs/r/UrSRFFKWBbfQBgoRlt~ltw/Duxqu3iZslJuJA~wlgOsCA
  - https://www.servicenow.com/docs/r/SmYvGPN0OygSQs53fsexIQ/~SbtOTOa~WZVLzH~tYKVxA

## 2. Third parties

- **Community MCP servers.** All of them are Table API wrappers. None mirrors to git, and no
  README read describes a plan, gate and push flow.
  - echelon-ai-labs/servicenow-mcp: 304 stars, MIT license. More than 70 ITSM, catalog and script
    tools, writes included.
    - https://github.com/echelon-ai-labs/servicenow-mcp (*read*)
  - jschuller/mcp-server-servicenow: 19 tools, including an update-set "promotion review". It
    shows read-only identities only read-only tools, and was verified on Brazil (2026-10-11).
    - https://github.com/jschuller/mcp-server-servicenow
  - Others: sukhmal (169 tools), torkian (180 tools), Oisub (development, debugging and update-set
    migration), tedorigawa001 (a read-only security scan of an update set's composition).
    - https://github.com/sukhmal/servicenow-mcp
    - https://github.com/Oisub/servicenow-mcp
- **Quality Clouds**, the closest direct competitor. Rebranded "AI Code Governance for
  ServiceNow":
  - scans development, test, UAT and git repositories;
  - LivecheckAI, quality gates, 350 to about 1,000 rules and an AI Rule Builder;
  - a hosted MCP server for Claude Code, Cursor and Copilot, and a Now Assist "Code Agent";
  - proprietary; prices aren't public.
  - https://github.com/qualityclouds/platform-mcp (*read*)
  - https://store.servicenow.com/store/app/2350aa951b6ee250c34d2135624bcb85
- **AutomatePro** (London, 2013). AI test automation and DevOps for ServiceNow. Prices aren't
  public.
  - https://www.cbinsights.com/company/automatepro
- **xtype**: governance across instances, governed deployments, and syncing instances instead of
  cloning them.
  - https://carahsoft.com/xtype
- **Perspectium**: InstanceSync keeps non-production data in sync without full clones.
  - https://docs.perspectium.com/x/Uwld
- **SN Utils**: a free browser extension, with a Pro tier for AI commands.
  - https://addons.mozilla.org/addon/1009097/
- **RapDev APO** (2026): a managed service in which AI agents work the ServiceNow backlog, with
  policy checks and senior engineers overseeing them. It claims delivery 3 to 4 times faster.
  - https://www.rapdev.io/resources/rapdev-launches-apo-a-governed-ai-agent-platform-for-operating-servicenow-at-scale
- **Echelon**: a $4.75M seed led by Bain Capital Ventures (2025-10-09). An autonomous AI
  ServiceNow developer, from requirements to deployment, claiming 12- to 16-week projects in days.
  - https://www.businesswire.com/news/home/20251009239309/en/Echelon-Emerges-from-Stealth-to-Automate-Enterprise-IT-Services-and-Implementation-with-AI-Agents
  - https://echelonai.com/blog/introducing-echelon-ai-servicenow-developer (2025-12-17)
- **Not found:** a ServiceNow-aware offering from Checkmarx, Fortify or Veracode; Copado or
  Flosum for ServiceNow.

## 3. Where the hours go

- **Upgrades:**
  - 2 to 3 days to a week of work before and after the upgrade, per environment; 1 to 2 months
    for development, QA and production together (*weak*, a search snippet; source page not
    confirmed).
    - https://www.servicenow.com/community/product-launch-forum/yokohama-upgrade/m-p/3337983
  - up to 4 months for a heavily customized customer (2021 case study).
    - https://www2.fujitsu.com/-/media/Project/Fujitsu/Fujitsu-Portal/customer-stories/pdf-cs1/cs-centrica-plc-20210319.pdf
  - 2 to 4 weeks to verify a major upgrade, about half of it manual testing (Coforge, date
    unclear).
    - https://www.coforge.com/blog/how-automated-test-framework-reduces-bottlenecks-related-to-upgrades
- **Clone-downs and instance hygiene** (xtype survey, Q4 2024, published 2025-05-28; sample size
  not disclosed, from a vendor):
  - 70% say clone-downs disrupt development;
  - 43% clone quarterly;
  - 25% track audit logs in spreadsheets;
  - 16% give admins full access in every environment;
  - 55% of mature users name customization versus standardization as their top challenge.
  - https://www.silicon.co.uk/press-release/new-report-reveals-opportunities-to-optimize-servicenow-operations-as-platform-adoption-accelerates
- **Technical debt.** Across more than 115 instances, the average configuration ratio is 67% and
  lines of code grow every year (Quality Clouds, 2022 to 2023).
  - https://marketing.qualityclouds.com/hubfs/Whitepapers%20Updated/ServiceNow%20Development%20Report%202023.pdf
- **Update sets** are a recognized pain point. ServiceNow's answers are collision avoidance, the
  Upgrade Plan and Developer Sandboxes.
- **No public survey data was found** on hours spent troubleshooting production, reviewing ACLs
  and security, tuning performance, keeping the CMDB healthy, or documenting.

## 4. Market size

- About 8,700 to 8,800 customers; 603 above $5M ACV (10-K, end of 2025).
  - https://www.sec.gov/Archives/edgar/data/1373715/000137371526000007/now-20251231.htm
- More than 2,700 partners, earning $6.02 per $1 of ServiceNow revenue. Lifecycle services grow
  from about 37% to 50% of partner profit by 2029 (IDC study of more than 300 partners, 2026-09-23,
  *read*).
  - https://www.channeldive.com/news/service-now-partners-profiting-in-AI-age/831057/
- About 1 million community members and about 25,000 certified developers (*weak*).
  - https://pulserevops.com/knowledge/q1666
- Rates:
  - UK median contract day rate £550 (six months to April 2025);
    - https://www.itjobswatch.co.uk/contracts/uk/servicenow%20developer.do
  - US contractors $85 to $135 an hour mid-level, $110 to $171 senior;
    - https://www.secondtalent.com/cost-to-hire/servicenow-developer/
  - consulting $200 to $400 an hour (a vendor claim).
- Team size: anecdotes put teams at 3 to 7 people even in organizations with 50,000 users. xtype
  reports that 66% of financial-services teams have 16 people or more (*weak*).

## 5. Implications (from the research, before the design's own analysis)

1. ServiceNow will own "build a new app with an agent": Build Agent, Autonomous Engineer, the
   SDK's skills and Fluent conversion are free or bundled, and run on Claude.
2. ServiceNow's MCP runs actions. It doesn't give an agent the existing customized metadata as a
   local, git-versioned mirror.
3. Read-only production by construction is a differentiator. Community servers wrap the Table API
   with writes, and ServiceNow's tools trust the instance.
4. On guardrails, Quality Clouds is the direct competitor. The deprecation of Proactive Code Check
   leaves room for guardrails that work offline, live in git and run in CI.
5. Upgrades, clone-downs and update-set drift are under-served and expensive. *Guess:* ServiceNow
   adds AI there next.
6. Partners are a channel. They pay for developer days and live on lifecycle services.
7. Before building around troubleshooting and security reviews, find out in interviews how many
   hours they really take: nobody publishes numbers.
