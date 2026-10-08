import { canonicalText } from "../../kernel/canonical-text";
import { SnagenticError } from "../../kernel/errors";
import { recordHash } from "../../kernel/record-hash";
import { ScopeName } from "../../kernel/scope-name";
import { slug } from "../../kernel/slug";
import { SysId } from "../../kernel/sys-id";
import { TableName } from "../../kernel/table-name";
import type { Artifact } from "./artifact";
import type { Catalog } from "./catalog";
import { fileFields } from "./field-rules";

const NAME_FIELDS = ["sys_name", "name", "api_name", "internal_name", "element", "title", "id"];
const LAYOUT_KEYS = new Set(["scope", "hash", "hash_version", "redacted"]);

export class InvalidRecordError extends SnagenticError {
  constructor(reason: string) {
    super(
      "invalid-record",
      "precondition",
      `unreadable record file: ${reason}`,
      "restore it with git, or run: snagentic pull",
    );
  }
}

export interface RenderedRecord {
  // Relative to the instance's metadata folder; the YAML is `${base}.yaml`.
  readonly base: string;
  readonly document: Readonly<Record<string, unknown>>;
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

function displayName(fields: Readonly<Record<string, string>>): string {
  for (const name of NAME_FIELDS) {
    const value = fields[name]?.trim();
    if (value) {
      return name === "element" && fields["name"] ? `${fields["name"]}.${value}` : value;
    }
  }
  return "record";
}

// ADR-0017: [domains/<domain>/]<scope>/<class>/<slug>--<sys_id>
export function recordBase(artifact: Artifact): string {
  const { domain, scope, className, sysId } = artifact.identity;
  const leaf = `${slug(displayName(artifact.fields))}--${sysId}`;
  const prefix = domain === "global" ? "" : `domains/${domain}/`;
  return `${prefix}${scope}/${className}/${leaf}`;
}

const SYS_ID_LEAF = /--([0-9a-f]{32})$/;

// A record's folder ([domains/<domain>/]<scope>/<class>) and sys_id, from its base path. The
// slug before the sys_id comes from sys_name, which the platform sets: only these identify it.
export function recordAddress(base: string): { folder: string; sysId: string } | null {
  const slash = base.lastIndexOf("/");
  const sysId = SYS_ID_LEAF.exec(base.slice(slash + 1))?.[1];
  return sysId === undefined || slash < 0 ? null : { folder: base.slice(0, slash), sysId };
}

export interface RelocatedRecord {
  // Record bases (paths without extension), relative to the metadata root.
  readonly local: string;
  readonly mirror: string;
}

// Records the workspace holds under one name and the mirror under another: the same sys_id in
// the same scope and class folder. Pull names files after sys_name, which the platform sets
// when the record is created, so a record created here usually comes back renamed.
export function relocatedRecords(
  localBases: readonly string[],
  mirrorBases: readonly string[],
): RelocatedRecord[] {
  const mirror = new Map<string, string>();
  for (const base of mirrorBases) {
    const address = recordAddress(base);
    if (address !== null) {
      mirror.set(`${address.folder}/${address.sysId}`, base);
    }
  }
  return localBases.flatMap((local) => {
    const address = recordAddress(local);
    const match = address === null ? undefined : mirror.get(`${address.folder}/${address.sysId}`);
    return match === undefined || match === local ? [] : [{ local, mirror: match }];
  });
}

export function renderRecord(artifact: Artifact, catalog: Catalog): RenderedRecord {
  const base = recordBase(artifact);
  const exploded = fileFields(catalog, artifact.identity.className);
  const plain: Record<string, string> = {};
  const files: { path: string; content: string }[] = [];
  for (const [field, value] of Object.entries(artifact.fields).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const extension = exploded.get(field);
    if (extension !== undefined && value !== "") {
      files.push({ path: `${base}.${field}.${extension}`, content: `${value}\n` });
    } else {
      plain[field] = value;
    }
  }
  const meta = {
    ...artifact.meta,
    scope: artifact.identity.scope,
    hash: artifact.hash,
    hash_version: 1,
    ...(artifact.redacted.length > 0 ? { redacted: [...artifact.redacted] } : {}),
  };
  return { base, document: { _meta: meta, ...plain }, files };
}

function metaOf(document: unknown): Record<string, unknown> {
  if (document === null || typeof document !== "object" || !("_meta" in document)) {
    throw new InvalidRecordError("missing _meta");
  }
  const meta = document._meta;
  if (meta === null || typeof meta !== "object") {
    throw new InvalidRecordError("_meta is not a mapping");
  }
  return meta as Record<string, unknown>;
}

function provenance(raw: Readonly<Record<string, unknown>>): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!LAYOUT_KEYS.has(key)) {
      meta[key] = String(value ?? "");
    }
  }
  return meta;
}

function contentFields(
  document: Readonly<Record<string, unknown>>,
  files: readonly { readonly field: string; readonly content: string }[],
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key !== "_meta") {
      fields[key] = canonicalText(value === null || value === undefined ? "" : String(value));
    }
  }
  for (const file of files) {
    fields[file.field] = canonicalText(file.content);
  }
  return fields;
}

// Reads a parsed YAML document plus its field files back into an artifact.
export function parseRecord(
  document: unknown,
  files: readonly { readonly field: string; readonly content: string }[],
): { readonly artifact: Artifact; readonly storedHash: string | null } {
  const raw = metaOf(document);
  const meta = provenance(raw);
  const fields = contentFields(document as Record<string, unknown>, files);
  const className = TableName.parse(meta["sys_class_name"] ?? "");
  const identity = {
    sysId: SysId.parse(meta["sys_id"] ?? ""),
    className,
    scope: ScopeName.fromInstance(String(raw["scope"] ?? "")),
    domain: ScopeName.fromInstance(meta["sys_domain"] ?? "global"),
  };
  const redacted = Array.isArray(raw["redacted"]) ? raw["redacted"].map(String) : [];
  const artifact = { identity, meta, fields, redacted, hash: recordHash(className, fields) };
  return { artifact, storedHash: typeof raw["hash"] === "string" ? raw["hash"] : null };
}
