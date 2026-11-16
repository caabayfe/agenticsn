import { Command, Help } from "commander";
import type { UseCase } from "../registry/use-case";
import { HELP_SECTIONS } from "../registry/use-case-help";

const ROOT_FOOTER = "\nRun snagentic <command> --help for options and examples.";
const GLOBAL_FOOTER = "\nGlobal option: --workspace <path> selects the workspace.";

export function exampleLine(tokens: readonly string[]): string {
  return `snagentic ${tokens.map((token) => (/^[\w./:@=-]+$/.test(token) ? token : JSON.stringify(token))).join(" ")}`;
}

export function helpSection(useCase: UseCase): string {
  const help = useCase.help;
  if (help?.visibility === "advanced") return "Advanced:";
  if (help?.visibility === "internal") return "Internal:";
  return `${help?.section ?? "Commands"}:`;
}

export function commandHelp(command: Command, useCase: UseCase): void {
  const help = useCase.help;
  command
    .summary(help?.summary ?? useCase.description)
    .description(help?.details ?? useCase.description)
    .helpGroup(useCase.group === undefined ? helpSection(useCase) : "Commands:");
  if (help === undefined) return;
  const formatter = new Help();
  command.addHelpText("after", () => {
    const width = command.createHelp().helpWidth ?? 80;
    const effects = formatter.boxWrap(help.effects, width - 2).split("\n");
    return [
      "\nEffects:",
      ...effects.map((line) => `  ${line}`),
      "\nExamples:",
      ...help.examples.map((tokens) => `  ${exampleLine(tokens)}`),
      GLOBAL_FOOTER,
    ].join("\n");
  });
}

function visibleCommands(
  command: Command,
  root: Command,
  helper: Help,
  all: boolean,
  useCases: readonly UseCase[],
): Command[] {
  const visible = helper.visibleCommands(command);
  for (const implicit of visible.filter((child) => !command.commands.includes(child))) {
    implicit.helpGroup(command === root ? "Manage:" : "Commands:");
  }
  const children = all
    ? [...command.commands, ...visible.filter((child) => !command.commands.includes(child))]
    : visible;
  const priority = (command: Command) =>
    useCases.find((u) => u.group === undefined && u.name === command.name())?.help?.order ?? 0;
  return command === root ? children.sort((a, b) => priority(a) - priority(b)) : children;
}

// Changes discovery only: hidden commands are still registered and directly callable.
export function configureRootHelp(program: Command, useCases: readonly UseCase[]): void {
  let all = false;
  const helper = new Help();
  const sections: readonly string[] = HELP_SECTIONS.map((section) => `${section}:`);
  program.configureHelp({
    subcommandTerm: (command) => helper.subcommandTerm(command).replace(" [options]", ""),
    visibleCommands: (command) => visibleCommands(command, program, helper, all, useCases),
    groupItems: (unsorted, visible, getGroup) =>
      new Map(
        [...helper.groupItems(unsorted, visible, getGroup)].sort(
          ([a], [b]) => sections.indexOf(a) - sections.indexOf(b),
        ),
      ),
  });
  program.addHelpCommand(
    new Command("help")
      .argument("[command]")
      .description("Show help for a command")
      .helpGroup("Manage:"),
  );
  program
    .option("--help-all", "include advanced and internal commands")
    .on("option:help-all", () => {
      all = true;
      program.help();
    });
  program.addHelpText("after", ROOT_FOOTER);
}
