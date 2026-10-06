// Writes docs/reference/commands.md from the registry (bun run docs).
import { writeFileSync } from "node:fs";
import { commandReference } from "../packages/cli/src/cli/command-reference";
import { USE_CASES } from "../packages/cli/src/registry/registry";

writeFileSync("docs/reference/commands.md", commandReference(USE_CASES));
console.log("wrote docs/reference/commands.md");
