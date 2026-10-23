import type { InstallPlan, PlannedField } from "./install-plan";

// Sections of the install plan document (ADR-0038, item 2.1): the platform fields the modules
// read, and the data the install loads.

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
