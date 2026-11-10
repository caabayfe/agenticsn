import { z } from "zod";

// What a pull did with the team's shared mirror (ADR-0052); absent without one.
export const SharedPullOutput = z.object({
  remote: z.string(),
  // The branch this pull continued from: this clone's, or the shared one it moved to.
  from: z.enum(["local", "shared"]),
  // The shared tip as fetched; null when the remote has no mirror of this instance yet.
  sharedCommit: z.string().nullable(),
  // Minutes since the watermark the pull continued from.
  ageMinutes: z.number().nullable(),
  maxAgeMinutes: z.number(),
  published: z.boolean(),
});
export type SharedPullOutput = z.output<typeof SharedPullOutput>;

export function sharedLines(shared: SharedPullOutput | undefined): string[] {
  if (shared === undefined) return [];
  return [
    shared.from === "shared"
      ? `  continued from the shared mirror on ${shared.remote} (${shared.sharedCommit?.slice(0, 10) ?? ""})`
      : `  continued from this clone's mirror; shared mirror on ${shared.remote}: ${shared.sharedCommit?.slice(0, 10) ?? "none yet"}`,
    ...(shared.published ? [`  published servicenow-remote to ${shared.remote}`] : []),
  ];
}

// A mirror younger than maxAge: nothing was asked of the instance.
export function renderCurrent(instance: string, shared: SharedPullOutput | undefined): string {
  const age = shared?.ageMinutes ?? 0;
  return [
    `${instance}: the mirror is current (pulled ${age} min ago, max ${shared?.maxAgeMinutes ?? 0}); nothing was asked of the instance`,
    ...sharedLines(shared),
    "  pull --now pulls anyway",
    `next: snagentic integrate ${instance}`,
  ].join("\n");
}
