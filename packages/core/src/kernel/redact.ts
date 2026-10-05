const REDACTED = "[redacted]";

const PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/(authorization:\s*(?:basic|bearer)\s+)[^\s",]+/gi, `$1${REDACTED}`],
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]*@/gi, `$1${REDACTED}@`],
  [/((?:client_secret|password|access_token|refresh_token)=)[^&\s;]+/gi, `$1${REDACTED}`],
  [/("(?:password|client_secret|access_token|refresh_token)"\s*:\s*")[^"]*"/gi, `$1${REDACTED}"`],
];

// Removes credentials from text shown to people or agents (errors, logs). Known secret
// values are removed wherever they appear; common credential shapes are removed by pattern.
export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let result = text;
  for (const secret of knownSecrets) {
    if (secret.length >= 4) {
      result = result.replaceAll(secret, REDACTED);
    }
  }
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
