import { listQuestions, QUESTION_KINDS } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const Listed = z.object({
  ref: z.string(),
  ask: z.string(),
  kind: z.enum(QUESTION_KINDS),
  who: z.string(),
  status: z.enum(["open", "answered", "dropped"]),
  answer: z.string().optional(),
  about: z.array(z.string()).readonly(),
  citedBy: z.array(z.string()).readonly(),
});

export const docsQuestions = defineUseCase({
  group: "docs",
  name: "questions",
  description:
    "List the documentation's questions (ADR-0041): processes/<process>/questions.yaml and the " +
    "shared documentation/questions.yaml. Before asking a new question, look for it here and cite " +
    "the one that exists ([Q01], [<process>/Q01] or [shared/Q01]). --about a record " +
    "(<table>/<sys_id> or a sys_id), --search words, --process, --status (open by default, or all).",
  input: z.object({
    about: z.string().optional().describe("questions about this record: <table>/<sys_id>"),
    search: z.string().optional().describe("words that must all appear in the question"),
    process: z.string().optional().describe("a process id, or shared"),
    status: z
      .enum(["open", "answered", "dropped", "all"])
      .optional()
      .describe("open (default), answered, dropped or all"),
  }),
  output: z.object({ questions: z.array(Listed).readonly() }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const questions = await listQuestions(
      { ...context.documentation(root), root },
      {
        ...(input.about === undefined ? {} : { about: input.about }),
        ...(input.search === undefined ? {} : { search: input.search }),
        ...(input.process === undefined ? {} : { process: input.process }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
    );
    return { questions: [...questions] };
  },
  render(output) {
    if (output.questions.length === 0) return "no questions match";
    return output.questions
      .map((question) =>
        [
          `${question.ref} [${question.kind}, ${question.who}${question.status === "open" ? "" : `, ${question.status}`}] ${question.ask}`,
          ...(question.answer === undefined ? [] : [`  answer: ${question.answer}`]),
          ...question.citedBy.map((page) => `  on ${page}`),
        ].join("\n"),
      )
      .join("\n");
  },
  exitCode: () => 0,
});
