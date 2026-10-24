import {
  completeUpdateSets,
  InstanceName,
  installPack,
  mirrorSchema,
  openUpdateSets,
  readLayouts,
  VERSION,
} from "@snagentic/core";
import { z } from "zod";
import { renderPlan, renderRun } from "./accelerator-install-render";
import { InstallViewOutput, installView } from "./accelerator-install-view";
import { DataSourceInput, dataSourceOf, SelectionInput, selectionOf } from "./accelerator-schemas";
import { connect } from "./connect";
import { callerFor, installSteps } from "./install-steps";
import { knowledgeSession } from "./knowledge-session";
import { defineUseCase } from "./use-case";

const Step = z.object({
  step: z.string(),
  outcome: z.enum(["done", "skipped", "stopped"]),
  detail: z.string(),
  seconds: z.number(),
});

export const acceleratorInstall = defineUseCase({
  group: "accelerator",
  name: "install",
  description:
    "Install an accelerator pack's modules on a development instance (ADR-0038). Without " +
    "--confirm it writes the install plan for the platform admin (components to activate, " +
    "each module's update set and source, out-of-box records changed, data to load, risks) " +
    "and changes nothing. With --confirm <plan id> it runs exactly that plan: components, then " +
    "each module through validate, plan_push and push into its own update set, then the data, " +
    "then commits the plan and a report. A run that stops resumes with the same command.",
  input: z.object({
    pack: z.string(),
    instance: z.string(),
    ...SelectionInput,
    ...DataSourceInput,
    confirm: z.string().optional().describe("the plan id the admin approved"),
  }),
  output: z.object({
    planId: z.string(),
    planPath: z.string(),
    reportPath: z.string().nullable(),
    problems: z.array(z.string()).readonly(),
    warnings: z.array(z.string()).readonly(),
    modules: z.array(z.string()).readonly(),
    steps: z.array(Step).readonly(),
    stopped: Step.nullable(),
    commit: z.string().nullable(),
    ...InstallViewOutput,
  }),
  flags: { readOnly: false, destructive: true, requiresDevelopmentInstance: true },
  mcp: false,
  arguments: ["pack", "instance"],
  async handle(input, context, run) {
    // Update sets are read live (ADR-0018): the plan lists the pack's earlier ones in progress.
    const connection = await connect(context, input.instance, run.signal);
    const { root, profile, reader, pager } = connection;
    const name = InstanceName.parse(input.instance);
    const result = await installPack(
      {
        packs: context.packs,
        inventory: context.inventory,
        workspace: context.packWorkspace(root, name),
        templates: context.dataTemplates,
        schema: mirrorSchema(() => knowledgeSession(context, String(name), run.progress)),
        updateSets: {
          open: (signal) =>
            openUpdateSets({ pager, statistics: reader, now: context.clock }, signal),
        },
        steps: {
          ...installSteps(
            context,
            { root, instance: name, pack: input.pack },
            callerFor(context, run),
          ),
          completeUpdateSets: (sets, signal) =>
            completeUpdateSets(
              reader.writer,
              sets.map((s) => s.sysId),
              signal,
            ),
          layouts: (facts, signal) => readLayouts(reader, facts, signal),
        },
        journal: context.installJournal(root, name),
        now: context.clock,
      },
      {
        ...selectionOf(input),
        pack: input.pack,
        instance: { root, name: String(name), kind: profile.kind },
        source: dataSourceOf(input, context.host.cwd),
        snagentic: VERSION,
        signal: run.signal,
        ...(input.domain === undefined ? {} : { domain: input.domain }),
        ...(input.confirm === undefined ? {} : { confirm: input.confirm }),
      },
    );
    return {
      planId: result.plan.planId,
      planPath: result.planPath,
      reportPath: result.reportPath,
      problems: result.plan.problems,
      warnings: result.plan.warnings,
      modules: result.plan.modules.map((m) => m.id),
      steps: result.steps,
      stopped: result.stopped,
      commit: result.commit,
      ...installView(result.plan),
    };
  },
  render(output) {
    return output.reportPath === null ? renderPlan(output) : renderRun(output);
  },
  exitCode: (output) => (output.problems.length > 0 || output.stopped !== null ? 1 : 0),
});
