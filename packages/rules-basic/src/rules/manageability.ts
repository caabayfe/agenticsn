import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { isCall, methodName, nameOf, recordOf, report } from "../ast";

const SYS_ID = /^[0-9a-f]{32}$/;
const INSTANCE_URL =
  /https?:\/\/(?!(?:www|hi|install|docs|developer|support|store|community|instance|signon|nowlearning)\.)[\w-]+\.(?:service-now\.com|servicenowservices\.com)/i;

// The name X in `var X = Class.create()` or `X = Class.create()`.
function classDefined(node: ESTree.Node | null | undefined): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    nameOf(node.callee.object) === "Class" &&
    methodName(node) === "create"
  );
}

export const MANAGEABILITY_RULES: Readonly<Record<string, Rule.RuleModule>> = {
  "SN-MNT-001": {
    create: (context) => ({
      Literal(node) {
        if (typeof node.value === "string" && SYS_ID.test(node.value)) {
          report(
            context,
            node,
            "a sys_id is hardcoded; it differs between instances and breaks when the record is recreated",
          );
        }
      },
    }),
  },
  "SN-MNT-002": {
    create: (context) => ({
      Literal(node) {
        if (typeof node.value === "string" && INSTANCE_URL.test(node.value)) {
          report(
            context,
            node,
            "an instance URL is hardcoded and will point at the wrong instance after clone or promotion",
          );
        }
      },
      TemplateElement(node) {
        if (INSTANCE_URL.test(node.value.cooked ?? "")) {
          report(
            context,
            node,
            "an instance URL is hardcoded and will point at the wrong instance after clone or promotion",
          );
        }
      },
    }),
  },
  "SN-MNT-003": {
    create: (context) => ({
      CallExpression(node) {
        if (
          recordOf(context).scoped &&
          (isCall(node, "gs", "log") || isCall(node, "gs", "print"))
        ) {
          report(context, node, `gs.${methodName(node)}() is not available in scoped applications`);
        }
      },
    }),
  },
  "SN-MNT-004": {
    create: (context) => ({
      CallExpression(node) {
        const first = node.arguments[0];
        if (
          methodName(node) === "setWorkflow" &&
          first?.type === "Literal" &&
          first.value === false
        ) {
          report(
            context,
            node,
            "setWorkflow(false) skips business rules, auditing and notifications for this write",
          );
        }
      },
    }),
  },
  "SN-MNT-005": {
    create: (context) => {
      const defined: { name: string; node: ESTree.Node }[] = [];
      return {
        VariableDeclarator(node) {
          if (node.id.type === "Identifier" && classDefined(node.init)) {
            defined.push({ name: node.id.name, node });
          }
        },
        AssignmentExpression(node) {
          if (node.left.type === "Identifier" && classDefined(node.right)) {
            defined.push({ name: node.left.name, node });
          }
        },
        "Program:exit"() {
          const name = recordOf(context).name.trim();
          const first = defined[0];
          if (name !== "" && first !== undefined && defined.every((d) => d.name !== name)) {
            report(
              context,
              first.node,
              `the class is '${first.name}' but the script include is named '${name}'; callers cannot resolve it`,
            );
          }
        },
      };
    },
  },
};
