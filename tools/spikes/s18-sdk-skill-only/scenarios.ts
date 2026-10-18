// Spike S18 scenarios: the prompts of snagentic's evaluation (scripts/eval/scenarios.ts), plus a
// delivery turn and one greenfield application, where the SDK should be at its best.
import { cp, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";

export interface SpikeScenario {
  readonly id: string;
  readonly turns: readonly string[];
  readonly context?: string;
  readonly prepare?: (cwd: string) => Promise<void>;
}

const SEED = join(import.meta.dir, "seed-review");
const SDK_MODULES = join(import.meta.dir, "../../../packages/cli/node_modules");

async function git(cwd: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
  if ((await child.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

// A scoped Fluent project, committed, then a new script include left uncommitted: "my changes".
async function seedReview(cwd: string): Promise<void> {
  await cp(SEED, cwd, { recursive: true });
  await symlink(SDK_MODULES, join(cwd, "node_modules"));
  const added = ["src/fluent/incident-cleanup.now.ts", "src/server/incident-cleanup.server.js"];
  const parked = join(cwd, "..", "parked");
  await mkdir(join(parked, "src/fluent"), { recursive: true });
  await mkdir(join(parked, "src/server"), { recursive: true });
  for (const file of added) {
    await cp(join(cwd, file), join(parked, file));
    await rm(join(cwd, file));
  }
  await Bun.write(join(cwd, ".gitignore"), "node_modules\ndist\n");
  await git(cwd, "init", "-q");
  await git(cwd, "add", "-A");
  await git(
    cwd,
    "-c",
    "user.name=dev",
    "-c",
    "user.email=dev@example.com",
    "commit",
    "-qm",
    "base",
  );
  for (const file of added) await cp(join(parked, file), join(cwd, file));
  await rm(parked, { recursive: true });
}

export const SCENARIOS: readonly SpikeScenario[] = [
  {
    id: "explain-assignment",
    turns: [
      "When I save an incident, what can change its assignment group? Tell me what runs and where it is defined.",
    ],
  },
  {
    id: "explain-state-on-assignment",
    turns: ["Why does an incident's state change to In Progress when someone assigns it?"],
  },
  {
    id: "design-notify-p1",
    turns: ["When a P1 incident is created, notify the on-call manager."],
  },
  {
    id: "build-mandatory-business-service",
    turns: [
      "Make the Business service field mandatory on the incident form when the priority is 1 - Critical.",
      "Approved. Go ahead and build it.",
      "Now deliver it to my development instance, so it is captured in an update set I can promote.",
    ],
  },
  {
    id: "review-risky-change",
    turns: ["Review my changes before I deliver them."],
    prepare: seedReview,
  },
  {
    id: "greenfield-equipment-loan",
    turns: [
      [
        "Create a small scoped application, Equipment Loan, for lending laptops to employees.",
        "A loan has the employee, the laptop's asset tag, a due date and a state (requested, on loan,",
        "returned, overdue). A loan can't be saved with a due date in the past. Only users with the",
        "itil role may create or change loans. Add an ATF test for the due-date rule. Deploy it to my",
        "development instance.",
      ].join(" "),
    ],
  },
];
