export const SECRET_PATTERN_IDS = [
  "private-key",
  "authorization-token",
  "aws-access-key-id",
  "github-token",
  "slack-token",
  "google-api-key",
  "url-credentials",
  "jwt",
] as const;

export type SecretPatternId = (typeof SECRET_PATTERN_IDS)[number];

export interface SecretScan {
  readonly text: string;
  readonly patterns: readonly SecretPatternId[];
}

export interface SecretRedaction {
  readonly path: string;
  readonly patterns: readonly SecretPatternId[];
}

export interface SecretDocumentScan {
  readonly document: unknown;
  readonly patterns: readonly SecretPatternId[];
}

const byPath = (left: SecretRedaction, right: SecretRedaction) =>
  left.path.localeCompare(right.path);

export function sortSecretRedactions(
  redactions: readonly SecretRedaction[],
): readonly SecretRedaction[] {
  return redactions.toSorted(byPath);
}

interface SecretPattern {
  readonly id: SecretPatternId;
  readonly expression: RegExp;
  readonly replacement: string;
}

const marker = (id: SecretPatternId) => `[redacted:${id}]`;

const PATTERNS: readonly SecretPattern[] = [
  {
    id: "private-key",
    expression:
      /-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH) )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]*?-----END \1-----/g,
    replacement: marker("private-key"),
  },
  {
    id: "authorization-token",
    expression: /(authorization\s*:\s*(?:basic|bearer)\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
    replacement: `$1${marker("authorization-token")}`,
  },
  {
    id: "aws-access-key-id",
    expression: /\bAKIA[A-Z0-9]{16}\b/g,
    replacement: marker("aws-access-key-id"),
  },
  {
    id: "github-token",
    expression: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/g,
    replacement: marker("github-token"),
  },
  {
    id: "slack-token",
    expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    replacement: marker("slack-token"),
  },
  {
    id: "google-api-key",
    expression: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    replacement: marker("google-api-key"),
  },
  {
    id: "url-credentials",
    expression: /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    replacement: `$1${marker("url-credentials")}@`,
  },
  {
    id: "jwt",
    expression: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: marker("jwt"),
  },
];

// Redacts only credential shapes measured as high-confidence on a real mirror (ADR-0035).
export function scanSecrets(text: string): SecretScan {
  let scanned = text;
  const patterns: SecretPatternId[] = [];
  for (const pattern of PATTERNS) {
    const next = scanned.replace(pattern.expression, pattern.replacement);
    if (next !== scanned) patterns.push(pattern.id);
    scanned = next;
  }
  return { text: scanned, patterns };
}

function orderedPatterns(found: ReadonlySet<SecretPatternId>): readonly SecretPatternId[] {
  return SECRET_PATTERN_IDS.filter((id) => found.has(id));
}

// YAML-shaped documents are plain records, arrays and scalar values. Keys are schema names;
// every string value is instance data and receives the same scan as an exploded field file.
export function scanDocumentSecrets(document: unknown): SecretDocumentScan {
  if (typeof document === "string") {
    const scanned = scanSecrets(document);
    return { document: scanned.text, patterns: scanned.patterns };
  }
  if (Array.isArray(document)) {
    const found = new Set<SecretPatternId>();
    const values = document.map((value) => {
      const scanned = scanDocumentSecrets(value);
      for (const id of scanned.patterns) found.add(id);
      return scanned.document;
    });
    return { document: values, patterns: orderedPatterns(found) };
  }
  if (document !== null && typeof document === "object") {
    const found = new Set<SecretPatternId>();
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(document)) {
      const scanned = scanDocumentSecrets(value);
      values[key] = scanned.document;
      for (const id of scanned.patterns) found.add(id);
    }
    return { document: values, patterns: orderedPatterns(found) };
  }
  return { document, patterns: [] };
}
