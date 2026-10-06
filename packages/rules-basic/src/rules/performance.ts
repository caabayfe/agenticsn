import type { Rule } from "eslint";
import { constructedName, insideLoop, isCall, methodName, recordOf, report } from "../ast";

const QUERY_CLASSES = new Set(["GlideRecord", "GlideRecordSecure", "GlideAggregate", "GlideQuery"]);
const OUTBOUND = new Set(["RESTMessageV2", "SOAPMessageV2", "GlideHTTPRequest"]);

export const PERFORMANCE_RULES: Readonly<Record<string, Rule.RuleModule>> = {
  "SN-PERF-001": {
    create: (context) => ({
      CallExpression(node) {
        const when = recordOf(context).when;
        if ((when === "before" || when === "after") && isCall(node, "current", "update")) {
          const reason =
            when === "before"
              ? "the record is saved anyway after a before rule"
              : "it re-runs every before/after rule and can recurse";
          report(context, node, `current.update() in a ${when} business rule: ${reason}`);
        }
      },
    }),
  },
  "SN-PERF-002": {
    create: (context) => ({
      NewExpression(node) {
        const name = constructedName(node);
        if (name !== null && QUERY_CLASSES.has(name) && insideLoop(context, node)) {
          report(context, node, `new ${name}() inside a loop runs one query per iteration`);
        }
      },
    }),
  },
  "SN-PERF-003": {
    create: (context) => ({
      CallExpression(node) {
        if (node.callee.type === "MemberExpression" && methodName(node) === "getRowCount") {
          report(context, node, "getRowCount() fetches every matching row to count them");
        }
      },
    }),
  },
  "SN-PERF-004": {
    create: (context) => ({
      CallExpression(node) {
        if (isCall(node, "gs", "sleep")) {
          report(context, node, "gs.sleep() blocks a worker thread");
        }
      },
    }),
  },
  "SN-PERF-005": {
    create: (context) => ({
      NewExpression(node) {
        if (constructedName(node) === "GlideRecord") {
          report(
            context,
            node,
            "GlideRecord in a client script makes a synchronous server round trip and exposes table access to the browser",
          );
        }
      },
    }),
  },
  "SN-PERF-006": {
    create: (context) => ({
      CallExpression(node) {
        const method = methodName(node);
        if (node.callee.type === "MemberExpression" && method === "getXMLWait") {
          report(context, node, "getXMLWait() blocks the browser until the server responds");
        } else if (
          node.callee.type === "MemberExpression" &&
          method === "getReference" &&
          node.arguments.length < 2
        ) {
          report(context, node, "g_form.getReference() without a callback is synchronous");
        }
      },
    }),
  },
  "SN-PERF-007": {
    create: (context) => ({
      NewExpression(node) {
        const when = recordOf(context).when;
        const name = constructedName(node);
        if ((when === "before" || when === "display") && name !== null && OUTBOUND.has(name)) {
          report(
            context,
            node,
            `${name} in a ${when} business rule holds the user's transaction open for the remote call`,
          );
        }
      },
    }),
  },
};
