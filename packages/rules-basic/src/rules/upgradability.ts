import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { report } from "../ast";

const DOM_CALLS = new Set(["jQuery", "$j", "$$", "gel", "$"]);

// Only global names count: a property called document or $ on some object is not the DOM.
function isGlobal(node: ESTree.Node): boolean {
  const parent = (node as Rule.Node).parent;
  return !(parent?.type === "MemberExpression" && parent.property === node && !parent.computed);
}

export const UPGRADABILITY_RULES: Readonly<Record<string, Rule.RuleModule>> = {
  "SN-UPG-001": {
    create: (context) => ({
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          node.object.name === "document" &&
          isGlobal(node.object)
        ) {
          report(
            context,
            node,
            "direct document access depends on form HTML that changes between releases",
          );
        }
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && DOM_CALLS.has(node.callee.name)) {
          report(context, node, `${node.callee.name}(...) manipulates the DOM directly`);
        }
      },
    }),
  },
};
