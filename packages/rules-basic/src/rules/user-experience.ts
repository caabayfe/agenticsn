import type { Rule } from "eslint";
import { methodName, receiverName, recordOf, report } from "../ast";

const POLICY_METHODS = new Set([
  "setMandatory",
  "setDisplay",
  "setVisible",
  "setReadOnly",
  "setReadonly",
  "setDisabled",
]);
const SERVER_CALLS = new Set(["GlideAjax", "getReference", "GlideRecord"]);

export const USER_EXPERIENCE_RULES: Readonly<Record<string, Rule.RuleModule>> = {
  "SN-UX-001": {
    create: (context) => {
      let guarded = false;
      return {
        Identifier(node) {
          guarded ||= node.name === "isLoading";
        },
        "Program:exit"(node) {
          if (recordOf(context).type === "onChange" && !guarded) {
            report(
              context,
              node,
              "onChange script runs on form load too; return early when isLoading",
            );
          }
        },
      };
    },
  },
  "SN-UX-002": {
    create: (context) => {
      const formCalls = new Set<string>();
      let callsServer = false;
      return {
        Identifier(node) {
          callsServer ||= SERVER_CALLS.has(node.name);
        },
        CallExpression(node) {
          const method = methodName(node);
          if (receiverName(node) === "g_form" && method !== null) {
            formCalls.add(method);
          }
        },
        "Program:exit"(node) {
          const type = recordOf(context).type;
          const onlyState = [...formCalls].every(
            (call) => POLICY_METHODS.has(call) || call === "getValue",
          );
          const setsState = [...formCalls].some((call) => POLICY_METHODS.has(call));
          if (
            (type === "onLoad" || type === "onChange") &&
            !callsServer &&
            setsState &&
            onlyState
          ) {
            report(
              context,
              node,
              "this script only changes mandatory/visible/read-only state; a UI policy does that declaratively and also applies to lists and mobile",
            );
          }
        },
      };
    },
  },
  "SN-UX-003": {
    create: (context) => ({
      CallExpression(node) {
        const name = methodName(node);
        const global = node.callee.type === "Identifier" || receiverName(node) === "window";
        if (global && (name === "alert" || name === "confirm")) {
          report(context, node, `${name}() is a blocking browser dialog`);
        }
      },
    }),
  },
};
