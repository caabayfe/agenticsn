// The text an admin reads from accelerator install: the plan in sections (what it installs,
// activates and lacks, then the next command), or the run as one line per step.

export interface MissingFieldView {
  readonly field: string;
  // The plugin that ships it, when the pack names one.
  readonly from: string | null;
  // A field the install cannot go on without.
  readonly blocking: boolean;
  readonly modules: readonly { readonly module: string; readonly effect: string | null }[];
}

export interface InstallView {
  readonly pack: string;
  readonly version: string;
  readonly instance: string;
  readonly planId: string;
  readonly planPath: string;
  readonly reportPath: string | null;
  readonly problems: readonly string[];
  readonly modules: readonly string[];
  readonly activates: readonly { readonly id: string; readonly modules: readonly string[] }[];
  readonly missingFields: readonly MissingFieldView[];
  // Warnings other than missing fields.
  readonly notes: readonly string[];
  readonly steps: readonly {
    readonly step: string;
    readonly outcome: "done" | "skipped" | "stopped";
    readonly detail: string;
    readonly seconds: number;
  }[];
  readonly stopped: { readonly step: string } | null;
}

const WIDTH = 88;

// Words joined by `separator`, wrapped to lines indented by `indent`.
function wrapped(words: readonly string[], indent: string, separator = " "): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line === "" ? word : `${line}${separator}${word}`;
    if (line !== "" && indent.length + next.length > WIDTH) {
      lines.push(`${indent}${line}${separator.trimEnd()}`);
      line = word;
    } else line = next;
  }
  if (line !== "") lines.push(`${indent}${line}`);
  return lines;
}

const text = (sentence: string, indent: string) => wrapped(sentence.split(" "), indent);

function section(title: string, body: readonly string[]): string[] {
  return body.length === 0 ? [] : ["", title, ...body];
}

function fieldLines(fields: readonly MissingFieldView[]): string[] {
  const width = Math.max(0, ...fields.flatMap((f) => f.modules.map((m) => m.module.length)));
  return fields.flatMap((f) => [
    `  ${f.field}${f.from === null ? "" : `   (ships with ${f.from})`}`,
    ...f.modules.flatMap((m) =>
      m.effect === null
        ? [`    ${m.module}`]
        : text(`${m.module.padEnd(width)}  ${m.effect}`, "    ").map((line, i) =>
            i === 0 ? line : `${" ".repeat(width + 2)}${line}`,
          ),
    ),
  ]);
}

const FIELD_FIX = "  fix: repair or activate the plugin that ships each field, then pull";

export function renderPlan(view: InstallView): string {
  const blocking = view.missingFields.filter((f) => f.blocking);
  const lacking = view.missingFields.filter((f) => !f.blocking);
  const fieldProblems = new Set(blocking.map((f) => f.field));
  const others = view.problems.filter((p) => ![...fieldProblems].some((f) => p.includes(` ${f} `)));
  const ready = view.problems.length === 0;
  return [
    `Install plan ${view.planId}: ${view.pack} ${view.version} on ${view.instance}`,
    `  review: ${view.planPath}`,
    ...section(`Modules (${view.modules.length})`, wrapped(view.modules, "  ", ", ")),
    ...section(
      `Activates (${view.activates.length})`,
      view.activates.map((c) => `  ${c.id}   for ${c.modules.join(", ")}`),
    ),
    ...section(`Blocked (${view.problems.length})`, [
      ...others.flatMap((p) => text(p, "  - ").map((l, i) => (i === 0 ? l : `    ${l.slice(4)}`))),
      ...fieldLines(blocking),
      ...(blocking.length > 0 ? [FIELD_FIX] : []),
    ]),
    ...section(
      `Missing fields (${lacking.length}): the install goes on without them`,
      lacking.length === 0 ? [] : [...fieldLines(lacking), FIELD_FIX],
    ),
    ...section(
      `Warnings (${view.notes.length})`,
      view.notes.flatMap((n) => text(n, "  - ").map((l, i) => (i === 0 ? l : `    ${l.slice(4)}`))),
    ),
    "",
    "Next",
    ...(ready
      ? [
          "  have the plan reviewed, then run the same command with:",
          `    --confirm ${view.planId}`,
        ]
      : ["  fix the blocking problems, then plan again"]),
  ].join("\n");
}

const MARK = { done: "✓", skipped: "–", stopped: "✗" } as const;

export function renderRun(view: InstallView): string {
  const width = Math.max(0, ...view.steps.map((s) => s.step.length));
  return [
    `Install ${view.planId}: ${view.pack} ${view.version} on ${view.instance}`,
    "",
    ...view.steps.flatMap((s) => [
      `  ${MARK[s.outcome]} ${s.step.padEnd(width)}  ${String(Math.round(s.seconds)).padStart(5)} s`,
      ...text(s.detail, "      "),
    ]),
    "",
    view.stopped === null
      ? `Installed. Report: ${view.reportPath ?? ""}`
      : `Stopped at ${view.stopped.step}: fix it, then run the same command to resume.\nReport: ${view.reportPath ?? ""}`,
  ].join("\n");
}
