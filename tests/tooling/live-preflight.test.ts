import { describe, expect, it } from "bun:test";
import {
  githubReport,
  missingSettings,
  notConfigured,
  preflightOf,
  REQUIRED_SETTINGS,
} from "../../scripts/live-preflight";

const SET = {
  SNAGENTIC_PDI_URL: "dev1.service-now.com",
  SNAGENTIC_PDI_USERNAME: "live.user",
  SNAGENTIC_PDI_PASSWORD: "not-a-real-password",
};

describe("the live run's check of its instance (spec 016, T1)", () => {
  it("finds nothing missing when the environment has every setting", () => {
    expect(missingSettings(SET)).toEqual([]);
  });

  it("names each setting that is absent or empty, as GitHub passes an unset one", () => {
    expect(missingSettings({ ...SET, SNAGENTIC_PDI_PASSWORD: "" })).toEqual([
      "SNAGENTIC_PDI_PASSWORD",
    ]);
    expect(missingSettings({})).toEqual([...REQUIRED_SETTINGS]);
  });

  it("ends neutrally, naming what to create, when the environment is not set up", () => {
    const preflight = notConfigured(["SNAGENTIC_PDI_PASSWORD"]);
    expect(preflight.state).toBe("not-configured");
    expect(preflight.title).toBe("Live run not configured, nothing tested");
    expect(preflight.message).toContain("SNAGENTIC_PDI_PASSWORD");
    expect(preflight.message).toContain("live-pdi");
  });

  it("lets the tests run when the instance answered the signed-in read", () => {
    expect(preflightOf({ outcome: "ready" }).state).toBe("ready");
  });

  it("ends neutrally when the instance hibernates or cannot be reached", () => {
    for (const outcome of ["asleep", "unreachable"] as const) {
      const preflight = preflightOf({ outcome, message: "dev1 is hibernating", hint: "wake it" });
      expect(preflight.state).toBe("asleep");
      expect(preflight.title).toBe("Instance asleep, nothing tested");
      expect(preflight.message).toContain("dev1 is hibernating");
    }
  });

  it("fails when the instance refuses the sign-in or answers something unexpected", () => {
    for (const outcome of ["unauthorized", "refused"] as const) {
      const preflight = preflightOf({ outcome, message: "refused", hint: "check the password" });
      expect(preflight.state).toBe("failed");
      expect(preflight.message).toContain("check the password");
    }
  });

  it("reports a neutral end as a notice and a failure as an error, with the state as output", () => {
    const asleep = githubReport(preflightOf({ outcome: "asleep", message: "m", hint: "h" }));
    expect(asleep.output).toBe("state=asleep\n");
    expect(asleep.annotation).toMatch(/^::notice title=Instance asleep, nothing tested::/);
    expect(asleep.summary).toContain("Instance asleep, nothing tested");
    const failed = githubReport(preflightOf({ outcome: "refused", message: "m", hint: "h" }));
    expect(failed.annotation).toMatch(/^::error title=/);
    expect(githubReport(preflightOf({ outcome: "ready" })).annotation).toBeNull();
  });

  it("keeps an annotation on one line, whatever the instance's message holds", () => {
    const report = githubReport(
      preflightOf({ outcome: "refused", message: "a\nb", hint: "c\r\nd" }),
    );
    expect(report.annotation).not.toMatch(/[\r\n]/);
  });
});
