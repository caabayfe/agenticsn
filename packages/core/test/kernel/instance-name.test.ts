import { describe, expect, it } from "bun:test";
import { InstanceName, InvalidIdentifierError } from "@snagentic/core";

describe("InstanceName", () => {
  it.each(["dev", "pdi", "acme-prod", "test2", "a"])("accepts %p", (value) => {
    expect(InstanceName.is(value)).toBe(true);
  });

  it.each(["", "Dev", "2dev", "-dev", "dev-", "dev--test", "dev_test", "dev/test", "a".repeat(41)])(
    "rejects %p, which would be an unsafe folder or branch name",
    (value) => {
      expect(InstanceName.is(value)).toBe(false);
    },
  );

  it("raises InvalidIdentifierError with code invalid-instance-name", () => {
    expect(() => InstanceName.parse("Dev")).toThrow(InvalidIdentifierError);
  });
});
