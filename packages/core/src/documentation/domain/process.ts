import { DocumentationSourceError } from "./errors";
import { fieldsOf, textOf } from "./fields";

// Who consumes a process: the people the user guide is written for.
export interface ProcessRole {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

// One thing people do in the process (report, assign, resolve…), in the order they meet it.
export interface ProcessCapability {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly roles: readonly string[];
}

export interface LifecycleState {
  readonly state: string;
  readonly meaning: string;
}

// A business process as its consumers see it (documentation/processes/<id>/process.yaml).
export interface Process {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly order: number;
  readonly roles: readonly ProcessRole[];
  readonly lifecycle: readonly LifecycleState[];
  readonly capabilities: readonly ProcessCapability[];
}

export const OVERVIEW = "overview";
const ID = /^[a-z][a-z0-9-]*$/;

function list(path: string, raw: unknown, what: string): readonly unknown[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new DocumentationSourceError(path, `${what} must be a list`);
  }
  return raw;
}

function id(path: string, value: unknown, what: string): string {
  const text = textOf(value);
  if (text === undefined || !ID.test(text)) {
    throw new DocumentationSourceError(
      path,
      `${what} needs an id of lowercase letters, digits and -`,
    );
  }
  return text;
}

function role(path: string, raw: unknown): ProcessRole {
  const fields = fieldsOf(raw);
  const roleId = id(path, fields["id"], "each role");
  return {
    id: roleId,
    name: textOf(fields["name"]) ?? roleId,
    description: textOf(fields["description"]) ?? "",
  };
}

function capability(path: string, raw: unknown, roles: ReadonlySet<string>): ProcessCapability {
  const fields = fieldsOf(raw);
  const capabilityId = id(path, fields["id"], "each capability");
  if (capabilityId === OVERVIEW) {
    throw new DocumentationSourceError(
      path,
      `${OVERVIEW} is the process's own page, not a capability`,
    );
  }
  const used = list(path, fields["roles"], `capability ${capabilityId} roles`).map(String);
  const unknown = used.filter((name) => !roles.has(name));
  if (unknown.length > 0) {
    throw new DocumentationSourceError(
      path,
      `capability ${capabilityId} names unknown roles: ${unknown.join(", ")}`,
    );
  }
  return {
    id: capabilityId,
    title: textOf(fields["title"]) ?? capabilityId,
    summary: textOf(fields["summary"]) ?? "",
    roles: used,
  };
}

// `path` is processes/<id>/process.yaml.
export function parseProcess(path: string, raw: unknown): Process {
  const fields = fieldsOf(raw);
  const processId = path.split("/")[1] ?? "";
  const title = textOf(fields["title"]);
  if (title === undefined) {
    throw new DocumentationSourceError(path, "needs a title");
  }
  const roles = list(path, fields["roles"], "roles").map((item) => role(path, item));
  const known = new Set(roles.map((item) => item.id));
  const capabilities = list(path, fields["capabilities"], "capabilities").map((item) =>
    capability(path, item, known),
  );
  const ids = capabilities.map((item) => item.id);
  const twice = ids.find((item, index) => ids.indexOf(item) !== index);
  if (twice !== undefined) {
    throw new DocumentationSourceError(path, `capability ${twice} is listed twice`);
  }
  const order = fields["order"];
  return {
    id: processId,
    title,
    summary: textOf(fields["summary"]) ?? "",
    order: typeof order === "number" ? order : Number(order ?? 999) || 999,
    roles,
    lifecycle: list(path, fields["lifecycle"], "lifecycle").map((item) => {
      const state = fieldsOf(item);
      return { state: textOf(state["state"]) ?? "", meaning: textOf(state["meaning"]) ?? "" };
    }),
    capabilities,
  };
}
