import { describe, expect, it } from "bun:test";
import {
  ERROR_CATEGORIES,
  EXIT_CODES,
  exitCodeFor,
  InvalidIdentifierError,
  SnagenticError,
} from "@snagentic/core";

class StaleMirrorError extends SnagenticError {
  constructor() {
    super("stale-mirror", "precondition", "mirror is 3 days old", "run: snagentic pull");
  }
}

describe("errors and exit codes", () => {
  it("carries a stable code, a message and a hint naming the next action", () => {
    const error = new StaleMirrorError();
    expect(error.code).toBe("stale-mirror");
    expect(error.message).toBe("mirror is 3 days old");
    expect(error.hint).toBe("run: snagentic pull");
  });

  it("maps every error category to exactly one exit code", () => {
    expect(ERROR_CATEGORIES.map((category) => EXIT_CODES[category])).toEqual([1, 2, 3, 4, 5]);
  });

  it("uses the category's exit code for a known error", () => {
    expect(exitCodeFor(new StaleMirrorError())).toBe(3);
    expect(exitCodeFor(new InvalidIdentifierError("invalid-sys-id", "a/b"))).toBe(2);
  });

  it("exits with 70 for an unexpected error", () => {
    expect(exitCodeFor(new Error("boom"))).toBe(70);
    expect(exitCodeFor("not even an error")).toBe(70);
  });
});
