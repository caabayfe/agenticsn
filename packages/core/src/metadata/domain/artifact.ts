import { canonicalText } from "../../kernel/canonical-text";
import { HASH_EXCLUDED_FIELDS, recordHash } from "../../kernel/record-hash";
import type { Row } from "../../kernel/row";
import { ScopeName } from "../../kernel/scope-name";
import { SysId } from "../../kernel/sys-id";
import { TableName } from "../../kernel/table-name";
import type { Catalog } from "./catalog";
import { fieldsToRedact, type RedactionPolicy } from "./redaction";
import { type SecretPatternId, scanSecrets } from "./secret-scan";

export interface ArtifactIdentity {
  readonly sysId: SysId;
  readonly className: TableName;
  readonly scope: ScopeName;
  // "global" or the domain's sys_id, normalized as a path segment.
  readonly domain: string;
}

// One ServiceNow metadata record. Field values are canonical text (ADR-0007).
export interface Artifact {
  readonly identity: ArtifactIdentity;
  // Identity and provenance fields (never part of the hash).
  readonly meta: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, string>>;
  readonly redacted: readonly string[];
  readonly secretFindings: readonly SecretFieldFinding[];
  readonly hash: string;
}

export interface SecretFieldFinding {
  readonly field: string;
  readonly patterns: readonly SecretPatternId[];
}

function keepScanned(
  target: Record<string, string>,
  field: string,
  value: string,
  redacted: string[],
  findings: SecretFieldFinding[],
): void {
  const scanned = scanSecrets(value);
  target[field] = scanned.text;
  if (scanned.patterns.length > 0) {
    redacted.push(field);
    findings.push({ field, patterns: scanned.patterns });
  }
}

export function artifactFromRow(row: Row, catalog: Catalog, policy: RedactionPolicy): Artifact {
  const className = TableName.parse(row["sys_class_name"] ?? "");
  const redact = fieldsToRedact(catalog, className, row, policy);
  const meta: Record<string, string> = {};
  const fields: Record<string, string> = {};
  const redacted: string[] = [];
  const secretFindings: SecretFieldFinding[] = [];
  for (const [field, value] of Object.entries(row)) {
    if (HASH_EXCLUDED_FIELDS.has(field)) {
      if (value !== "") keepScanned(meta, field, value, redacted, secretFindings);
    } else if (redact.has(field.toLowerCase())) {
      redacted.push(field);
    } else {
      keepScanned(fields, field, canonicalText(value), redacted, secretFindings);
    }
  }
  const identity = {
    sysId: SysId.parse(row["sys_id"] ?? ""),
    className,
    scope: catalog.scopeNamespace(row["sys_scope"]),
    domain: ScopeName.fromInstance(row["sys_domain"] ?? "global"),
  };
  return {
    identity,
    meta,
    fields,
    redacted: redacted.sort(),
    secretFindings: secretFindings.sort((a, b) => a.field.localeCompare(b.field)),
    hash: recordHash(className, fields),
  };
}
