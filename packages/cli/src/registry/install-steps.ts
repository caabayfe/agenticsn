import { join } from "node:path";
import { type InstallSteps, type InstanceName, LEDGER_FILE } from "@snagentic/core";
import type { z } from "zod";
import { acceleratorAdd } from "./accelerator-add";
import { acceleratorLoad } from "./accelerator-load";
import { fluentKeys } from "./fluent-keys";
import { integrate } from "./integrate";
import { planPush } from "./plan-push";
import { pluginsActivate } from "./plugins-activate";
import { pull } from "./pull";
import { push } from "./push";
import { takeOver } from "./take-over";
import type { RunControl, UseCase, UseCaseContext } from "./use-case";

// Runs a use case with an input given as on its command line (defaults filled by its schema).
export type CallUseCase = <I extends z.ZodObject, O extends z.ZodObject>(
  useCase: UseCase<I, O>,
  input: z.input<I>,
) => Promise<z.output<O>>;

export const callerFor =
  (context: UseCaseContext, run: RunControl): CallUseCase =>
  (useCase, input) => {
    run.progress({ message: [useCase.group, useCase.name].filter(Boolean).join(" ") });
    return useCase.handle(useCase.input.parse(input), context, run);
  };

// A collision with update sets this install named (an earlier run's, still open) is the
// install changing its own records: such a plan is made again with those collisions allowed.
const ownedBy = (own: readonly string[], set: string) =>
  own.some((label) => set === `snagentic: ${label}` || set.startsWith(`snagentic: ${label} [`));

// plan_push and push for one module's update set.
function deliverySteps(
  call: CallUseCase,
  instance: string,
): Pick<InstallSteps, "planPush" | "push"> {
  const allowed = new Set<string>();
  return {
    async planPush(label, _signal, own) {
      let out = await call(planPush, { instance, label });
      const ours = out.collisions.every((c) =>
        c.heldBy.every((h) => ownedBy(own, h.updateSetName)),
      );
      if (out.collisions.length > 0 && ours) {
        allowed.add(label);
        out = await call(planPush, { instance, label, allowCollisions: true });
      }
      const problems = [
        ...out.problems.map((p) => `${p.updateName || p.project}: ${p.reason}`),
        ...out.gate.blocking.map((f) => `${f.ruleId} ${f.path}: ${f.message}`),
        ...out.collisions
          .filter(() => !allowed.has(label))
          .map((c) => `${c.record} is held in another update set`),
      ];
      return { planId: out.planId, ready: out.ready, units: out.units.length, problems };
    },
    async push(planId, label) {
      const allowCollisions = allowed.has(label);
      const out = await call(push, {
        instance,
        plan: planId,
        confirm: true,
        label,
        allowCollisions,
      });
      return {
        units: out.units.length,
        notApplied: out.notApplied,
        notCaptured: out.notCaptured,
        updateSets: out.updateSets.map((u) => u.name),
      };
    },
  };
}

// An install's steps as the use cases that already do them (ADR-0038, item 2): no logic here,
// only each use case's input and the part of its output the install needs.
export function installSteps(
  context: UseCaseContext,
  where: { readonly root: string; readonly instance: InstanceName; readonly pack: string },
  call: CallUseCase,
): InstallSteps {
  const instance = String(where.instance);
  const delivery = () => context.delivery(where.root, where.instance);
  return {
    async activatePlugin(id) {
      const out = await call(pluginsActivate, { instance, id, confirm: true });
      return { seconds: out.seconds };
    },
    async refresh() {
      await call(pull, { instance });
      await call(integrate, { instance });
    },
    async add(modules) {
      const out = await call(acceleratorAdd, { pack: where.pack, instance, modules: [...modules] });
      return { copied: out.copied, conflicts: out.conflicts };
    },
    async keys(paths) {
      if (paths.length === 0) return;
      const out = await call(fluentKeys, { paths: [...paths] });
      const files = out.written.map((w) => `${w.path}/src/fluent/generated/keys.ts`);
      if (files.length === 0) return;
      await delivery().commitFiles(
        files,
        "chore(snagentic): keys for the accelerator's new records",
      );
    },
    async takeOver(records) {
      const out = await call(takeOver, {
        instance,
        records: records.map((r) => `${r.table}:${r.sysId}`),
      });
      const ledgers = [...new Set(out.taken.map((r) => `${r.project}/${LEDGER_FILE}`))];
      if (ledgers.length > 0) {
        await delivery().commitFiles(ledgers, "chore(snagentic): take over out-of-box layouts");
      }
      return {
        taken: out.taken.length,
        customized: out.customized.map((r) => `${r.table} ${r.sysId}`),
        absent: out.absent.map((r) => `${r.table} ${r.sysId}`),
      };
    },
    ...deliverySteps(call, instance),
    load: (modules, source) =>
      call(acceleratorLoad, {
        pack: where.pack,
        instance,
        modules: [...modules],
        confirm: true,
        ...(source.kind === "demo" ? { demo: true } : { data: source.directory }),
      }),
    async writeFile(path, text) {
      await context.workspaceFiles.write(join(where.root, path), text);
    },
    commit: (paths, message) => delivery().commitFiles(paths, message),
  };
}
