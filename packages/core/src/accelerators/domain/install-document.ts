import type {
  InstallPlan,
  InstallRecord,
  InstallStepRecord,
  PlannedComponent,
  PlannedField,
} from "./install-plan";

// The install plan and report as Markdown, written for the platform admin who approves the
// install (ADR-0038, item 3). Pure.

const table = (head: readonly string[], rows: readonly (readonly string[])[]) =>
  rows.length === 0
    ? ["None."]
    : [
        `| ${head.join(" | ")} |`,
        `|${head.map(() => "---").join("|")}|`,
        ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`),
      ];

const ACTION: Readonly<Record<PlannedComponent["action"], string>> = {
  none: "nothing (already active)",
  activate: "**activate**",
  blocked: "**blocked**",
};

function selectionText(plan: InstallPlan): string {
  const { profile, modules } = plan.selection;
  const parts = [
    ...(profile === undefined ? [] : [`profile \`${profile}\``]),
    ...(modules === undefined ? [] : [`modules ${modules.map((m) => `\`${m}\``).join(", ")}`]),
  ];
  return parts.length === 0 ? "every module" : parts.join(" and ");
}

function summary(plan: InstallPlan): string[] {
  const activations = plan.components.filter((c) => c.action === "activate").length;
  const rows = plan.data.entities.reduce((n, e) => n + e.rows, 0);
  const files = plan.modules.reduce((n, m) => n + m.files.length, 0);
  return [
    `# Install plan: ${plan.pack} ${plan.version} on ${plan.instance.name}`,
    "",
    `- **Plan id:** \`${plan.planId}\``,
    `- **Instance:** ${plan.instance.name} (${plan.instance.kind})`,
    `- **Selection:** ${selectionText(plan)}: ${plan.modules.map((m) => m.id).join(", ")}`,
    `- **Changes:** ${activations} component(s) activated; ${plan.modules.length} module(s) delivered from ${files} source file(s), each into its own update set; ${rows} ${plan.data.source === "demo" ? "fictional demo" : "customer"} data row(s) loaded`,
    "",
    "**It will not:** delete any record, change a record the plan does not list, write to a test or production instance, move, commit or cancel an update set, or complete an update set the plan does not list. Customizations are promoted with the platform's own update set process.",
  ];
}

function components(plan: InstallPlan): string[] {
  return [
    "## 1. Platform components",
    "",
    "Installed through the platform's own installer, one at a time, waiting for each to finish. Activating a plugin usually cannot be undone; demo data is never loaded.",
    "",
    ...table(
      ["Component", "Kind", "Needed by", "On the instance", "The install will"],
      plan.components.map((c) => [
        `\`${c.id}\``,
        c.kind,
        c.modules.join(", "),
        `${c.state}${c.version === null ? "" : ` ${c.version}`}`,
        `${ACTION[c.action]}${c.action === "none" ? "" : `: ${c.reason}`}`,
      ]),
    ),
    "",
    ...fields(plan.fields),
  ];
}

function fieldAction(f: PlannedField): string {
  if (f.state === "after-activation") return `checked again once ${f.from ?? ""} is active`;
  if (f.whenMissing === "warn") return `install anyway: ${f.note ?? "the module works without it"}`;
  return "**blocked**: repair or activate the plugin that ships it, then pull";
}

const STATE: Readonly<Record<PlannedField["state"], string>> = {
  present: "present",
  missing: "missing",
  "no-table": "no table",
  "after-activation": "after activation",
};

// The platform fields the modules read (plan gap G13): a missing one blocks its module, unless
// the module declared it can do without. Present fields are only counted.
function fields(planned: readonly PlannedField[]): string[] {
  const missing = planned.filter((f) => f.state !== "present");
  const present = planned.length - missing.length;
  if (planned.length === 0) return [];
  return [
    "**Platform fields the modules read**, checked against the mirror:",
    "",
    ...(missing.length === 0
      ? [`All ${present} field(s) are on the instance.`]
      : [
          ...table(
            ["Field", "Module", "On the instance", "Ships with", "The install will"],
            missing.map((f) => [
              `\`${f.table}.${f.field}\``,
              f.module,
              `**${STATE[f.state]}**`,
              f.from ?? "–",
              fieldAction(f),
            ]),
          ),
          "",
          `The other ${present} field(s) the modules read are on the instance.`,
        ]),
  ];
}

function modules(plan: InstallPlan): string[] {
  const adoptions = plan.modules.flatMap((m) => m.adoptions.map((a) => ({ ...a, module: m.id })));
  return [
    "## 2. Customizations, by module",
    "",
    "Each module is built from its Fluent source, validated, planned against the instance and pushed into the update set named below (one child per scope), then checked: every record must be captured and applied as built.",
    "",
    ...table(
      ["Module", "Update set", "Source files", "Projects"],
      plan.modules.map((m) => [
        m.id,
        `snagentic: ${m.label}`,
        String(m.files.length),
        [...new Set(m.files.map((f) => f.split("/").slice(0, 2).join("/")))].join(", "),
      ]),
    ),
    ...promotionOrder(plan),
    "",
    "**Out-of-box records changed** (an upgrade skips a customized record: review each):",
    "",
    ...table(
      ["Module", "Record", "What changes"],
      adoptions.map((a) => [
        a.module,
        `${a.table} ${a.sysId}`,
        a.whenAbsent === "create" ? `${a.note} (created where the instance lacks it)` : a.note,
      ]),
    ),
    ...layouts(plan),
    ...leftovers(plan),
  ];
}

// Facts about layouts the modules add to (ADR-0042): found by table and view when each module is
// delivered, after any plugin activation; a list already there is left as it is.
function layouts(plan: InstallPlan): string[] {
  const facts = plan.modules.flatMap((m) => m.ensures.map((f) => ({ ...f, module: m.id })));
  if (facts.length === 0) return [];
  return [
    "",
    "**Layouts the modules add to**, found by table and view when each module is delivered; a list already there is left as it is, and a layout the client customized stops for review:",
    "",
    ...table(
      ["Module", "Table and view", "Adds", "Why"],
      facts.map((f) => [f.module, `${f.table}, ${f.view}`, `related list ${f.list}`, f.note]),
    ),
  ];
}

// Files an earlier version wrote that this one dropped (ADR-0026, M8): kept, so the user removes
// them before the install runs.
function leftovers(plan: InstallPlan): string[] {
  if (plan.leftovers.length === 0) return [];
  return [
    "",
    "**Files this version no longer ships**, still in the workspace from an earlier add. snagentic never deletes them; remove each (`git rm`), commit, then plan again:",
    "",
    ...table(
      ["File"],
      plan.leftovers.map((path) => [`\`${path}\``]),
    ),
  ];
}

// The pack's earlier update sets still in progress are completed first (ADR-0038, section 6):
// with a record in two sets, the one committed last on the target wins.
function promotionOrder(plan: InstallPlan): string[] {
  if (plan.earlierSets.length === 0) return [];
  const rows = [
    ...plan.earlierSets.map((s) => [s.name, "completed by the install, before the first push"]),
    // Modules already installed go into the upgrade set, new ones into their own: the run
    // decides which, from the working branch.
    [
      `snagentic: ${plan.pack} ${plan.version} upgrade (modules already installed), then each new module's update set`,
      "this install",
    ],
  ];
  return [
    "",
    "**Update sets, in promotion order.** Earlier installs of this pack left these update sets in progress. The install completes them (their scope children follow) so they are promoted before this install's, and the newer version of a record wins. Promote them in this order:",
    "",
    ...table(
      ["#", "Update set", "Made by"],
      rows.map(([name = "", by = ""], i) => [String(i + 1), name, by]),
    ),
  ];
}

function data(plan: InstallPlan): string[] {
  return [
    "## 3. Data",
    "",
    `Loaded through each entity's import set after the modules, in dependency order. Every template is validated first and nothing loads until all pass. A row whose choice or reference does not resolve is rejected, not guessed. Loading again updates the same records: rows the pack owns (anchors) keep a fixed sys_id, other rows match on their business key.`,
    "",
    ...table(
      ["Entity", "Into", "Module", "Rows", "Matched on"],
      plan.data.entities.map((e) => [
        e.entity,
        e.target ?? "",
        e.module,
        String(e.rows),
        e.anchors ? "anchor sys_id, else business key" : "business key",
      ]),
    ),
  ];
}

function risks(plan: InstallPlan): string[] {
  return [
    "## 4. Risks and recovery",
    "",
    "- **Timeouts.** A component install that loses its answer is followed on the instance, never requested twice. A module push that times out is planned again against the instance, so nothing is loaded twice.",
    "- **Resume.** Run the same command with the same plan id: finished steps are skipped (active components, modules the instance already holds, rows unchanged).",
    "- **Cannot be undone by the install:** component activations. Records it created can be removed through a follow-up change, reviewed like any other.",
    ...(plan.warnings.length === 0
      ? []
      : ["", "**Warnings:**", "", ...plan.warnings.map((w) => `- ${w}`)]),
    ...(plan.problems.length === 0
      ? []
      : [
          "",
          "**Blocking problems (the install refuses until they are fixed):**",
          "",
          ...plan.problems.map((p) => `- ${p}`),
        ]),
    "",
    "## 5. Approval",
    "",
    plan.problems.length === 0
      ? `Approve by running: \`snagentic accelerator install ${plan.pack} ${plan.instance.name} ${selectionFlags(plan)}--confirm ${plan.planId}\``
      : "Not approvable: fix the blocking problems, then plan again.",
    "",
    `Built from mirror commit \`${plan.basis.mirrorCommit.slice(0, 12)}\`; any change on the instance or in the pack makes a new plan id.`,
  ];
}

function selectionFlags(plan: InstallPlan): string {
  const { profile, modules } = plan.selection;
  return [
    ...(profile === undefined ? [] : [`--profile ${profile} `]),
    ...(modules === undefined ? [] : modules.map((m) => `--modules ${m} `)),
    plan.data.source === "demo" ? "--demo " : "--data <directory> ",
  ].join("");
}

export function installPlanDocument(plan: InstallPlan): string {
  return [
    ...summary(plan),
    "",
    ...components(plan),
    "",
    ...modules(plan),
    "",
    ...data(plan),
    "",
    ...risks(plan),
    "",
  ].join("\n");
}

const OUTCOME: Readonly<Record<InstallStepRecord["outcome"], string>> = {
  done: "done",
  skipped: "skipped",
  stopped: "**stopped**",
};

// What an install did, step by step, for the plan the admin approved.
export function installReportDocument(
  plan: InstallPlan,
  record: InstallRecord,
  stopped: InstallStepRecord | null,
): string {
  const total = record.steps.reduce((n, s) => n + s.seconds, 0);
  return [
    `# Install report: ${plan.pack} ${plan.version} on ${plan.instance.name}`,
    "",
    `- **Approved plan:** \`${record.planId}\` (plan.md in this folder), started ${record.startedAt}`,
    `- **Result:** ${stopped === null ? "installed" : `stopped at ${stopped.step}: run the same command with --confirm ${record.planId} to resume`}`,
    `- **Time:** ${Math.round(total)} s across ${record.steps.length} step(s)`,
    "",
    ...table(
      ["Step", "Outcome", "Detail", "Seconds"],
      record.steps.map((s) => [s.step, OUTCOME[s.outcome], s.detail, String(s.seconds)]),
    ),
    "",
  ].join("\n");
}
