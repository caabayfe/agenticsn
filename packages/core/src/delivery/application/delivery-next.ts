import type { NextCall } from "../../knowledge/index";

export function planNext(
  query: { readonly instance: string; readonly recoverPending?: boolean },
  context: {
    readonly label: string;
    readonly planId: string;
    readonly ready: boolean;
    readonly gatePassed: boolean;
    readonly base: string;
  },
): readonly NextCall[] {
  if (!context.ready)
    return context.gatePassed ? [] : [{ tool: "validate", args: { base: context.base } }];
  return [
    {
      tool: "push",
      args: {
        instance: query.instance,
        label: context.label,
        plan: context.planId,
        confirm: true,
        ...(query.recoverPending ? { recoverPending: true } : {}),
      },
    },
  ];
}

export function pushNext(
  instance: string,
  label: string,
  recoverPending: boolean | undefined,
  needsReview: boolean,
): readonly NextCall[] {
  return needsReview
    ? [
        {
          tool: "plan_push",
          args: { instance, label, ...(recoverPending ? { recoverPending: true } : {}) },
        },
      ]
    : [{ tool: "status", args: { instance } }];
}
