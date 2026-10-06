import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { constructedName, methodName, nameOf, recordOf, report, stringValue } from "../ast";

const SECRET_NAME =
  /(?:^|_)(?:pass(?:word|wd)?|pwd|secret|client_?secret|api_?key|apikey|token|access_?token|auth_?token|private_?key)$/i;
const PROPERTY_LIKE = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/;
const PLACEHOLDER = /^(?:|\*+|x+|changeme|password|secret|token|<.*>|\$\{.*\}|\{\{.*\}\})$/i;

// A concatenation with any part that is not a string literal.
function dynamic(node: ESTree.Node): boolean {
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return dynamic(node.left) || dynamic(node.right);
  }
  return stringValue(node) === null;
}

// A literal that could be a real secret, not a name, key or message that merely sits in a
// variable called token or password (v1 heuristics).
function looksSecret(value: string): boolean {
  if (
    value.length < 6 ||
    PLACEHOLDER.test(value) ||
    PROPERTY_LIKE.test(value) ||
    /\s/.test(value)
  ) {
    return false;
  }
  const alpha = /[A-Za-z]/.test(value);
  return alpha && (/\d/.test(value) || /[^A-Za-z0-9_.-]/.test(value));
}

export const SECURITY_RULES: Readonly<Record<string, Rule.RuleModule>> = {
  "SN-SEC-001": {
    create: (context) => ({
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "eval") {
          report(context, node, "eval() executes arbitrary strings as code");
        } else if (
          node.callee.type === "MemberExpression" &&
          nameOf(node.callee.object) === "GlideEvaluator" &&
          methodName(node) === "evaluateString"
        ) {
          report(context, node, "GlideEvaluator.evaluateString() evaluates strings as code");
        }
      },
      NewExpression(node) {
        const name = constructedName(node);
        if (name === "GlideEvaluator" || name === "Function") {
          report(context, node, `new ${name}(...) compiles strings into code`);
        }
      },
    }),
  },
  "SN-SEC-002": {
    create: (context) => {
      const check = (
        key: ESTree.Node | null | undefined,
        value: ESTree.Node | null | undefined,
        node: ESTree.Node,
      ) => {
        const name = nameOf(key);
        const literal = stringValue(value);
        if (name !== null && SECRET_NAME.test(name) && literal !== null && looksSecret(literal)) {
          report(context, node, `'${name}' is assigned a literal secret`);
        }
      };
      return {
        VariableDeclarator: (node) => check(node.id, node.init, node),
        AssignmentExpression: (node) => check(node.left, node.right, node),
        Property: (node) => check(node.key, node.value, node),
        CallExpression(node) {
          const method = methodName(node);
          if (
            method === "setBasicAuth" &&
            node.arguments.length === 2 &&
            (stringValue(node.arguments[1] as ESTree.Node) ?? "") !== ""
          ) {
            report(context, node, "setBasicAuth() is called with a literal password");
          }
          if (
            method === "setRequestHeader" &&
            node.arguments.length === 2 &&
            (stringValue(node.arguments[0] as ESTree.Node) ?? "").toLowerCase() ===
              "authorization" &&
            /^(basic|bearer)\s+\S{8,}/i.test(stringValue(node.arguments[1] as ESTree.Node) ?? "")
          ) {
            report(context, node, "an Authorization header value is hardcoded");
          }
        },
      };
    },
  },
  "SN-SEC-003": {
    create: (context) => ({
      CallExpression(node) {
        const query = node.arguments[0];
        if (methodName(node) !== "addEncodedQuery" || query === undefined) {
          return;
        }
        const concatenated =
          query.type === "BinaryExpression" && query.operator === "+" && dynamic(query);
        const interpolated = query.type === "TemplateLiteral" && query.expressions.length > 0;
        if (concatenated || interpolated) {
          report(
            context,
            node,
            "encoded query is built by string concatenation; values containing '^' or 'OR' change the query",
          );
        }
      },
    }),
  },
  "SN-SEC-004": {
    create: (context) => ({
      Program(node) {
        if (
          recordOf(context).className !== "" &&
          recordOf(context).className !== "sys_security_acl"
        ) {
          return;
        }
        const text = context.sourceCode.getText(node).replace(/\s+/g, "");
        if (
          ["answer=true", "answer=true;", "true", "true;", "returntrue", "returntrue;"].includes(
            text,
          )
        ) {
          report(context, node, "the ACL script always evaluates to true");
        }
      },
    }),
  },
  "SN-SEC-005": {
    create: (context) => ({
      MemberExpression(node) {
        if (node.object.type === "Identifier" && node.object.name === "Packages") {
          report(context, node, "Packages.* calls Java classes directly");
        }
      },
    }),
  },
};
