import { abandonPending } from "@snagentic/core";
import { z } from "zod";
import { developmentTarget } from "./connect";
import type { UseCaseContext } from "./use-case";

export const AbandonedUnits = z
  .array(
    z.object({
      project: z.string(),
      updateName: z.string(),
      operation: z.string(),
      outcome: z
        .enum(["verified", "unverified", "unknown"])
        .describe(
          "verified: applied and captured, not in the ledger; unverified: written, not verified; unknown: the write may or may not have arrived",
        ),
      updateSet: z.string().describe("sys_id of the update set; empty when not recorded"),
      link: z.string(),
    }),
  )
  .readonly()
  .optional()
  .describe("only with abandonPending: what the abandoned delivery left on the instance");

// push --abandon-pending (ADR-0050, amendment A1): no credential, no connection.
export async function abandon(
  input: {
    readonly instance: string;
    readonly plan: string;
    readonly confirm: boolean;
    readonly pr?: string | undefined;
    readonly draftPr: boolean;
    readonly recoverPending: boolean;
  },
  context: UseCaseContext,
) {
  const { root, name, profile } = await developmentTarget(context, input.instance);
  return abandonPending(
    {
      journal: context.pushJournal(root, name),
      workspace: context.delivery(root, name),
      url: profile.url,
    },
    {
      instance: name,
      planId: input.plan,
      confirm: input.confirm,
      ...(input.pr === undefined ? {} : { pr: input.pr }),
      draftPr: input.draftPr,
      ...(input.recoverPending ? { recoverPending: true } : {}),
    },
  );
}

export function abandonedText(output: {
  readonly instance: string;
  readonly planId: string;
  readonly ledgerCommit: string | null;
  readonly warnings: readonly string[];
  readonly abandoned?:
    | readonly {
        readonly updateName: string;
        readonly operation: string;
        readonly outcome: string;
        readonly updateSet: string;
        readonly link: string;
      }[]
    | undefined;
}): string {
  return [
    `abandoned the unfinished delivery of push ${output.planId} to ${output.instance}: nothing was rolled back, and this stays on the instance:`,
    ...(output.abandoned ?? []).map(
      (u) =>
        `${u.operation.padEnd(6)} ${u.updateName}  ${u.outcome}  ${u.updateSet === "" ? "update set not recorded" : u.link}`,
    ),
    `recorded in commit ${(output.ledgerCommit ?? "").slice(0, 10)}; no ledger changed`,
    ...output.warnings.map((w) => `warning: ${w}`),
    `next: snagentic plan-push --instance ${output.instance}`,
  ].join("\n");
}
