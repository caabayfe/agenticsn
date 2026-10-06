// Merges snagentic's hooks and permission rules into a project's .claude/settings.json,
// keeping everything the team put there. Our hook entries are recognised by their command
// (`snagentic hook ...`) and replaced, so installing again never duplicates them.

type Json = unknown;

const isObject = (value: Json): value is Record<string, Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const OURS = /^snagentic hook /;

function isOurEntry(entry: Json): boolean {
  const hooks = isObject(entry) ? entry["hooks"] : undefined;
  return (
    Array.isArray(hooks) &&
    hooks.some((h) => isObject(h) && typeof h["command"] === "string" && OURS.test(h["command"]))
  );
}

function mergeHooks(existing: Json, ours: Record<string, readonly Json[]>): Record<string, Json> {
  const hooks: Record<string, Json> = isObject(existing) ? { ...existing } : {};
  for (const [event, entries] of Object.entries(ours)) {
    const theirs = Array.isArray(hooks[event])
      ? hooks[event].filter((entry) => !isOurEntry(entry))
      : [];
    hooks[event] = [...theirs, ...entries];
  }
  return hooks;
}

function mergeRules(existing: Json, ours: Record<string, readonly string[]>): Record<string, Json> {
  const permissions: Record<string, Json> = isObject(existing) ? { ...existing } : {};
  for (const [kind, rules] of Object.entries(ours)) {
    const theirs = Array.isArray(permissions[kind]) ? permissions[kind] : [];
    permissions[kind] = [...theirs, ...rules.filter((rule) => !theirs.includes(rule))];
  }
  return permissions;
}

// The settings file's new text, or null when the existing one is not a JSON object (left as is).
export function withClaudeSettings(
  existing: string | null,
  ours: {
    readonly hooks: Record<string, readonly Json[]>;
    readonly permissions: Record<string, readonly string[]>;
  },
): string | null {
  let settings: Json = {};
  if (existing !== null && existing.trim() !== "") {
    try {
      settings = JSON.parse(existing);
    } catch {
      return null;
    }
  }
  if (!isObject(settings)) {
    return null;
  }
  const merged = {
    ...settings,
    hooks: mergeHooks(settings["hooks"], ours.hooks),
    permissions: mergeRules(settings["permissions"], ours.permissions),
  };
  return `${JSON.stringify(merged, null, 2)}\n`;
}
