import type { Rule } from "eslint";
import type * as ESTree from "estree";

// What a rule knows about the record its script belongs to, passed in ESLint settings.
export interface RecordSettings {
  readonly className: string;
  // Business rules: before, after, async, display (platform values normalised by the caller).
  readonly when: string;
  // Client scripts: onLoad, onChange, onSubmit, onCellEdit.
  readonly type: string;
  readonly scoped: boolean;
  readonly name: string;
}

export function recordOf(context: Rule.RuleContext): RecordSettings {
  const settings = context.settings["servicenow"];
  const value = (key: string) =>
    typeof settings === "object" && settings !== null && key in settings
      ? String((settings as Record<string, unknown>)[key])
      : "";
  return {
    className: value("className"),
    when: value("when"),
    type: value("type"),
    scoped: value("scoped") === "true",
    name: value("name"),
  };
}

// x.method(...) → method; method(...) → method.
export function methodName(call: ESTree.CallExpression): string | null {
  const callee = call.callee;
  if (callee.type === "Identifier") {
    return callee.name;
  }
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}

// The receiver's name in name.method(...): only a plain identifier counts.
export function receiverName(call: ESTree.CallExpression): string | null {
  const callee = call.callee;
  return callee.type === "MemberExpression" && callee.object.type === "Identifier"
    ? callee.object.name
    : null;
}

export function isCall(call: ESTree.CallExpression, receiver: string, method: string): boolean {
  return (
    call.callee.type === "MemberExpression" &&
    receiverName(call) === receiver &&
    methodName(call) === method
  );
}

// new Name(...) or new namespace.Name(...) → Name.
export function constructedName(node: ESTree.NewExpression): string | null {
  const callee = node.callee;
  if (callee.type === "Identifier") {
    return callee.name;
  }
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}

// A string literal, or a template literal without expressions.
export function stringValue(node: ESTree.Node | null | undefined): string | null {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  }
  return null;
}

// The name a property key, identifier or member's property stands for.
export function nameOf(node: ESTree.Node | null | undefined): string | null {
  if (node?.type === "Identifier") {
    return node.name;
  }
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  return null;
}

const LOOPS = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

// Inside a loop body, or a function passed to forEach.
export function insideLoop(context: Rule.RuleContext, node: ESTree.Node): boolean {
  return context.sourceCode
    .getAncestors(node)
    .some(
      (ancestor) =>
        LOOPS.has(ancestor.type) ||
        (ancestor.type === "CallExpression" && methodName(ancestor) === "forEach"),
    );
}

export function report(context: Rule.RuleContext, node: ESTree.Node, message: string): void {
  context.report({ node, message });
}
