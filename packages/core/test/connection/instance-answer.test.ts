import { describe, expect, it } from "bun:test";
import {
  AccessDeniedError,
  AuthenticationFailedError,
  answerOf,
  type InstanceAnswer,
  InstanceHibernatingError,
  InstanceUnreachableError,
  RequestTimedOutError,
} from "@snagentic/core";

// What a person reads: the message or the hint of an answer that has one.
function text(answer: InstanceAnswer, field: "message" | "hint"): string {
  return answer.outcome === "ready" ? "" : answer[field];
}

describe("answerOf", () => {
  it("is ready when the attempt succeeds", async () => {
    expect(await answerOf("pdi", async () => {})).toEqual({ outcome: "ready" });
  });

  it("says a hibernating instance is asleep and how to wake it", async () => {
    const answer = await answerOf("pdi", async () => {
      throw new InstanceHibernatingError("https://dev1.service-now.com");
    });
    expect(answer.outcome).toBe("asleep");
    expect(text(answer, "hint")).toContain("developer.servicenow.com");
    expect(text(answer, "hint")).toContain("run the command again");
  });

  it("says a refused password may be a missing Basic authentication role", async () => {
    const answer = await answerOf("pdi", async () => {
      throw new AuthenticationFailedError("pdi");
    });
    expect(answer.outcome).toBe("unauthorized");
    expect(text(answer, "hint")).toContain("snc_basic_auth_api_access");
    expect(text(answer, "hint")).toContain("password");
  });

  it("keeps the address and the reason when the instance cannot be reached", async () => {
    const answer = await answerOf("pdi", async () => {
      throw new InstanceUnreachableError("https://dev1.service-now.com", "getaddrinfo ENOTFOUND");
    });
    expect(answer.outcome).toBe("unreachable");
    expect(text(answer, "message")).toContain("ENOTFOUND");
  });

  it("treats a request that timed out twice as unreachable", async () => {
    const answer = await answerOf("pdi", async () => {
      throw new RequestTimedOutError("https://dev1.service-now.com");
    });
    expect(answer.outcome).toBe("unreachable");
  });

  it("passes on another refusal with its own message and hint", async () => {
    const answer = await answerOf("pdi", async () => {
      throw new AccessDeniedError("sys_user", "ACL");
    });
    expect(answer.outcome).toBe("refused");
    expect(text(answer, "message")).toContain("sys_user");
    expect(text(answer, "hint")).toContain("read access");
  });

  it("does not hide a bug", async () => {
    await expect(
      answerOf("pdi", async () => {
        throw new TypeError("oops");
      }),
    ).rejects.toThrow("oops");
  });
});
