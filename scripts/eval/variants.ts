import { INSTRUCTIONS } from "../../packages/agent-packs/src/index";
import type { Variant } from "./types";

// Experiment 1 (spec 003, section 14): how much should the always-loaded instructions say?
// A is the shipped block; B adds a question-to-tool map and the CLI fallback; C spells out
// the tools' actions and ServiceNow practice.

const MAP = [
  "",
  "Which tool answers what",
  "- Where is X defined? `find` (`code` true searches inside scripts).",
  "- What runs on a table, in what order? What uses this record? `describe`.",
  "- How should I build this? `advise` with the intent and `tables`.",
  "- Is my change right? `validate` (`base` for a branch).",
  "- Is the mirror current? `status`; refresh with `pull`.",
  "- Update sets and plugins: `update_sets`, `plugins`.",
  "",
  "Without the MCP tools, run the same commands with the CLI: `snagentic <command> --format agent`",
  "(for example `snagentic describe incident --format agent`).",
];

const PRACTICE = [
  "",
  "ServiceNow practice",
  "- Order of preference: configuration (UI policy, data policy, notification, flow) before",
  "  script; a client script only when a UI policy cannot do it; a business rule only for",
  "  server logic that must run on every save.",
  "- Business rules: before rules change the record being saved and never call update();",
  "  after rules change other records; heavy or external work goes to async rules or events.",
  "- Never use eval, hardcoded sys_ids or instance URLs, or setWorkflow(false) without a reason.",
  "- Query with addQuery per condition; never build encoded queries from input.",
  "- Client scripts: guard onChange with isLoading; use GlideAjax, never synchronous calls.",
  "- Scoped apps: gs.info/warn/error, not gs.log.",
  "- Give every new script record a description.",
];

const withMap = `${INSTRUCTIONS}\n${MAP.join("\n")}`;

export const VARIANTS: readonly Variant[] = [
  { id: "A", describe: "shipped instructions", mcp: true, skills: true },
  {
    id: "B",
    describe: "A + tool map + CLI fallback",
    instructions: withMap,
    mcp: true,
    skills: true,
  },
  {
    id: "C",
    describe: "B + ServiceNow practice spelled out",
    instructions: `${withMap}\n${PRACTICE.join("\n")}`,
    mcp: true,
    skills: true,
  },
  { id: "A-cli", describe: "A without the MCP server", mcp: false, skills: true },
  {
    id: "B-cli",
    describe: "B without the MCP server",
    instructions: withMap,
    mcp: false,
    skills: true,
  },
];
