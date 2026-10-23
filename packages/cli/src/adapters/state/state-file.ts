import { SnagenticError } from "@snagentic/core";
import type { z } from "zod";

class InvalidStateFileError extends SnagenticError {
  constructor(path: string, reason: string, hint: string) {
    super("invalid-state-file", "precondition", `${path} is not valid: ${reason}`, hint);
  }
}

function reasonOf(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return "unexpected content";
  }
  const at = issue.path.join(".");
  return at === "" ? issue.message : `${at}: ${issue.message}`;
}

// Local state files are written by snagentic, but a crash, a hand edit or another version can
// leave one that isn't what the code expects. Reading it as the type would pass garbage on, so
// a file that isn't JSON of the expected shape stops with the file and the next action.
export function parseStateFile<T>(
  path: string,
  text: string,
  schema: z.ZodType<T>,
  hint: string,
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new InvalidStateFileError(path, "it is not JSON", hint);
  }
  return checkStateValue(path, raw, schema, hint);
}

// A value already read from local state (a database column), checked the same way.
export function checkStateValue<T>(
  path: string,
  raw: unknown,
  schema: z.ZodType<T>,
  hint: string,
): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidStateFileError(path, reasonOf(parsed.error), hint);
  }
  return parsed.data;
}
