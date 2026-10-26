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

// Words joined by `separator`, wrapped to lines of at most `width` (a longer word keeps its line).
function fit(words: readonly string[], width: number, separator = " "): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line === "" ? word : `${line}${separator}${word}`;
    if (line !== "" && next.length > width) {
      lines.push(`${line}${separator.trimEnd()}`);
      line = word;
    } else line = next;
  }
  if (line !== "") lines.push(line);
  return lines;
}

// Words joined by `separator`, wrapped to lines indented by `indent`.
const wrapped = (words: readonly string[], indent: string, separator = " ") =>
  fit(words, WIDTH - indent.length, separator).map((line) => `${indent}${line}`);

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

// A step's name takes at most this many columns: a longer one wraps, its time on the first line.
const STEP_WIDTH = 48;

function stepLines(step: InstallView["steps"][number], width: number): string[] {
  const [first = "", ...rest] = fit(step.step.split(" "), width);
  const time = `${String(Math.round(step.seconds)).padStart(5)} s`;
  return [
    `  ${MARK[step.outcome]} ${first.padEnd(width)}  ${time}`,
    ...rest.map((line) => `    ${line}`),
    ...text(step.detail, "      "),
  ];
}

const ALREADY = "modules already installed: ";

// The modules a step delivered or found delivered: its own, or those it re-installed together.
function delivered(step: InstallView["steps"][number]): string[] {
  if (step.outcome === "stopped") return [];
  if (step.step.startsWith("module ")) return [step.step.slice("module ".length)];
  if (step.step.startsWith(ALREADY)) return step.step.slice(ALREADY.length).split(", ");
  return [];
}

// How far a stopped run got, and the modules it has still to install.
function pending(view: InstallView): string[] {
  const installed = new Set(view.steps.flatMap(delivered));
  const left = view.modules.filter((m) => !installed.has(m));
  const count = `${view.modules.length - left.length} of ${view.modules.length} module(s) installed`;
  if (left.length === 0) return [`${count}; the steps after them are left`];
  return [`${count}; still to install (${left.length}):`, ...wrapped(left, "  ", ", ")];
}

export function renderRun(view: InstallView): string {
  const longest = Math.max(0, ...view.steps.map((s) => s.step.length));
  const width = Math.min(STEP_WIDTH, longest);
  const total = Math.round(view.steps.reduce((n, s) => n + s.seconds, 0) / 60);
  return [
    `Install ${view.planId}: ${view.pack} ${view.version} on ${view.instance}`,
    "",
    ...view.steps.flatMap((s) => stepLines(s, width)),
    "",
    ...(view.stopped === null
      ? [`Installed in ${total} min. Report: ${view.reportPath ?? ""}`]
      : [
          `Stopped at ${view.stopped.step}, ${total} min so far.`,
          ...pending(view),
          "Fix it, then run the same command to resume.",
          `Report: ${view.reportPath ?? ""}`,
        ]),
  ].join("\n");
}
