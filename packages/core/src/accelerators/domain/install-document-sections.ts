import type { InstallPlan, PlannedField } from "./install-plan";

// Sections of the install plan document (ADR-0038, item 2.1): the platform fields the modules
// read, the records they delete, and the data the install loads.

export const table = (head: readonly string[], rows: readonly (readonly string[])[]) =>
  rows.length === 0
    ? ["None."]
    : [
        `| ${head.join(" | ")} |`,
        `|${head.map(() => "---").join("|")}|`,
        ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`),
      ];

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
export function fieldsSection(planned: readonly PlannedField[]): string[] {
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

export function dataSection(plan: InstallPlan): string[] {
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
    ...domainNote(plan),
  ];
}

// Where the rows go on an instance that separates data by domain (spec 011, section 15).
function domainNote(plan: InstallPlan): string[] {
  const { domain, domainColumns } = plan.data;
  const columns = domainColumns.join(", ");
  if (domain.separated) {
    const mandatory =
      columns === "" ? "" : `; columns only domain separation uses are mandatory: ${columns}`;
    return ["", `Every row goes into the domain **${domain.name}**${mandatory}.`];
  }
  return columns === ""
    ? []
    : [
        "",
        `The instance does not separate data by domain: these columns are left out: ${columns}.`,
      ];
}

// Records the modules' source deletes (Now.del): the pack's own, such as a test step it replaced,
// deleted where the instance still holds them. A record a plugin ships is never deleted (ADR-0038
// section 8).
export function deletionsSection(plan: InstallPlan): string[] {
  const rows = plan.modules.flatMap((m) => m.deletions.map((d) => [m.id, d.table, d.sysId]));
  if (rows.length === 0) return [];
  return [
    "",
    "**Records the modules delete**, the pack's own records its source removes, deleted where the instance still holds them (none of the platform's):",
    "",
    ...table(["Module", "Table", "sys_id"], rows),
  ];
}

// What the components section says about store applications: that installing one cannot be
// undone, the demo data some bring (ADR-0048), and the demo modules left out without --demo.
export function componentNotes(plan: InstallPlan): string[] {
  return [
    ...(plan.components.some((c) => c.action === "install")
      ? [
          "Installing a store application cannot be undone by the install: it also installs the dependencies the store names, and removing it is done in Application Manager, where it may take data with it.",
          "",
        ]
      : []),
    ...(plan.components.some((c) => c.demoData === true)
      ? [
          "**Demo data** (`--demo`, ADR-0048): the applications marked *install with its demo data* load the platform's own demo records. Demo data a store application loads cannot be removed by snagentic.",
          "",
        ]
      : []),
    ...(plan.demoOnly.length === 0
      ? []
      : [
          `**Demo modules left out** (installed only with \`--demo\`): ${plan.demoOnly.join(", ")}`,
          "",
        ]),
  ];
}

// The demo modules' properties --demo turns on, never promoted (ADR-0049).
export function demoSettingsNote(plan: InstallPlan): string[] {
  const settings = Object.entries(plan.demoSettings);
  if (settings.length === 0) return [];
  const named = settings.map(([name, value]) => `\`${name}\` = \`${value}\``).join(", ");
  return [
    `**Demo modules turned on.** After the modules, the install sets ${named}, so their loaders run. The change goes into an update set of its own, \`snagentic: demo settings (development only)\`, set to *ignore*: it is never promoted, and the modules' own update sets keep them off (ADR-0049).`,
    "",
  ];
}

// The demo modules' load jobs --demo runs once, without waiting for them (ADR-0050).
export function demoJobsNote(plan: InstallPlan): string[] {
  if (plan.demoJobs.length === 0) return [];
  const named = plan.demoJobs.map((job) => `\`${job}\``).join(", ");
  return [
    `**Demo load jobs run.** Once the modules are on and the data is loaded, the install runs ${named} once, as *Execute Now* does. It does not wait for them: they write the demo records in the background, and the instance's system log shows their progress. A resumed install does not run them again (ADR-0050).`,
    "",
  ];
}
