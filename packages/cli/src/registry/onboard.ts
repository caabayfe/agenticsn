import { EXIT_CODES, INSTANCE_KINDS, onboard as runOnboarding } from "@snagentic/core";
import { z } from "zod";
import { onboardSteps } from "./onboard-steps";
import { defineUseCase } from "./use-case";

const Answer = z.object({
  outcome: z.enum(["ready", "asleep", "unauthorized", "unreachable", "refused"]),
  message: z.string().optional(),
  hint: z.string().optional(),
});

export const onboard = defineUseCase({
  help: {
    summary: "Connect an instance and prepare its workspace",
    section: "Get started",
    order: -1,
    details:
      "Create a workspace, add the profile, sign in, check connectivity, then pull and " +
      "integrate metadata. Rerun to continue after a stop. Wake a sleeping PDI before " +
      "retrying. Installs bundled user skills and workspace agent integration.",
    effects:
      "Writes workspace files and credentials to the OS keychain; reads the instance without changing it.",
    examples: [["onboard", "dev", "--url", "dev12345", "--username", "your.user"]],
  },
  name: "onboard",
  description:
    "Take a new instance from nothing to a pulled, integrated workspace in one command: create " +
    "the workspace, add the profile, sign in (the password is asked without echo and kept in the " +
    "OS keychain), check the instance answers, run doctor, pull and integrate. Says what to do " +
    "when a developer instance is asleep or refuses the user. Run it again to continue after a " +
    "stop: what is done is skipped. For people: an agent never sees the secret.",
  input: z.object({
    name: z.string().describe("short name used in commands and folders, e.g. dev"),
    url: z.string().describe("instance name (dev12345) or https address"),
    username: z
      .string()
      .describe("the instance user; with --client-id, the OAuth Application User"),
    clientId: z.string().optional().describe("OAuth client id, for the client-credentials grant"),
    kind: z.enum(INSTANCE_KINDS).default("development").describe("only development is written to"),
    acknowledgeReadOnly: z
      .boolean()
      .default(false)
      .describe("confirm that a test or production credential is read-only"),
    path: z
      .string()
      .optional()
      .describe(
        "the workspace folder (default: the workspace you are in, else ~/snagentic/<name>)",
      ),
  }),
  output: z.object({
    root: z.string().nullable(),
    instance: z.string(),
    steps: z.array(z.object({ step: z.string(), did: z.enum(["done", "already"]) })),
    stoppedAt: z.string().nullable(),
    answer: Answer,
    failedChecks: z.array(z.string()),
    nextSteps: z.array(z.string()),
    agentWarnings: z.array(z.string()).readonly().optional(),
  }),
  flags: {
    readOnly: false,
    destructive: false,
    requiresDevelopmentInstance: false,
    // It may create the workspace, so there is none to lock yet; the commands it runs lock
    // their own instance.
    lock: "none",
  },
  // It reads a secret, which never passes through an agent.
  mcp: false,
  arguments: ["name"],
  async handle(input, context, run) {
    const steps = onboardSteps(input, context, run);
    const result = await runOnboarding(steps);
    const root = steps.root();
    return {
      root,
      agentWarnings: steps.agentWarnings(),
      instance: input.name,
      steps: [...result.steps],
      stoppedAt: result.stoppedAt,
      answer: result.answer,
      failedChecks: [...result.failedChecks],
      nextSteps:
        result.stoppedAt === null && root !== null ? [`cd ${root}`, "snagentic status"] : [],
    };
  },
  render(output) {
    const done = output.steps.map((s) => `  ${s.did === "done" ? "done   " : "already"} ${s.step}`);
    if (output.stoppedAt === null) {
      return [
        `${output.instance} is onboarded`,
        ...done,
        ...(output.agentWarnings ?? []).map(
          (path) => `preserved agent file; review before use: ${path}`,
        ),
        "next:",
        ...output.nextSteps.map((step) => `  ${step}`),
      ].join("\n");
    }
    const why =
      output.failedChecks.length > 0
        ? [
            `doctor failed: ${output.failedChecks.join(", ")}`,
            `run: snagentic doctor --instance ${output.instance}`,
          ]
        : [output.answer.message ?? "", `hint: ${output.answer.hint ?? ""}`];
    return [`stopped at ${output.stoppedAt}`, ...done, ...why].join("\n");
  },
  exitCode: (output) => (output.stoppedAt === null ? 0 : EXIT_CODES.precondition),
});
