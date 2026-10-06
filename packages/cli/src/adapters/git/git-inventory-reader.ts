import { InstanceName, type InventoryReader, instancePaths, type Row } from "@snagentic/core";
import { fromYamlStrings } from "../yaml/own-style";
import { runGit } from "./run-git";

function rows(document: unknown): Row[] {
  if (!Array.isArray(document)) {
    return [];
  }
  return document.flatMap((item): Row[] =>
    item !== null && typeof item === "object"
      ? [Object.fromEntries(Object.entries(item).map(([key, value]) => [key, String(value ?? "")]))]
      : [],
  );
}

// Reads the inventory from the instance's remote branch, so it reflects the last pull whether
// or not it was integrated, and never the working tree.
export const gitInventoryReader: InventoryReader = {
  async read(root, instance, file) {
    const paths = instancePaths(InstanceName.parse(instance));
    const spec = `refs/heads/${paths.remoteBranch}:${paths.operational}/${file}.yaml`;
    const result = await runGit(["show", spec], root);
    return result.exitCode === 0 ? rows(fromYamlStrings(result.stdout)) : null;
  },
};
