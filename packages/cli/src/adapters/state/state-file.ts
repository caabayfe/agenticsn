import { readFile } from "node:fs/promises";
import { SnagenticError } from "@snagentic/core";
import type { z } from "zod";

class InvalidStateFileError extends SnagenticError {
  constructor(path: string, reason: string, hint: string) {
    super("invalid-state-file", "precondition", `${path} is not valid: ${reason}`, hint);
  }
}

class UnreadableStateFileError extends SnagenticError {
  constructor(path: string, reason: string) {
    super(
      "unreadable-state-file",
      "precondition",
      `${path} could not be read: ${reason}`,
      `check that you can read ${path} and its folder (permissions, a disk or sync tool holding it), then run the command again`,
    );
  }
}

// A state file's text, or null when there is none. Any other failure to read it stops: a journal
// that exists but can't be read is not "nothing to recover" (REL2-06).
export async function readStateText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new UnreadableStateFileError(
      path,
      error instanceof Error ? error.message : String(error),
    );
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
