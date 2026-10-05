import { describe, expect, it } from "bun:test";
import { redactSecrets } from "@snagentic/core";

describe("redactSecrets", () => {
  it.each([
    ["Authorization: Basic YWRtaW46cGFzcw==", "Authorization: Basic [redacted]"],
    ["authorization: bearer eyJhbGciOi.x.y", "authorization: bearer [redacted]"],
    [
      "GET https://admin:p%40ss@dev1.service-now.com/api",
      "GET https://[redacted]@dev1.service-now.com/api",
    ],
    ["token?client_secret=abc123&grant_type=x", "token?client_secret=[redacted]&grant_type=x"],
    ['{"password":"hunter2","user":"a"}', '{"password":"[redacted]","user":"a"}'],
    [
      "access_token=abc.def; refresh_token=ghi",
      "access_token=[redacted]; refresh_token=[redacted]",
    ],
  ])("redacts %p", (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts known secret values wherever they appear", () => {
    expect(redactSecrets("login failed for Jv!k0F1kC*Ch at step 2", ["Jv!k0F1kC*Ch"])).toBe(
      "login failed for [redacted] at step 2",
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "GET /api/now/table/sys_script?sysparm_limit=500 returned 503";
    expect(redactSecrets(text)).toBe(text);
  });
});
