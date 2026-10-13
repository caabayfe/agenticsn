import { describe, expect, it } from "bun:test";
import {
  elevate,
  type SignInPage,
  signIn,
} from "../../../../src/adapters/servicenow/elevation/browser-sign-in";

const BASE = "https://dev1.service-now.com";

// A login page as ServiceNow serves it: `outcome` decides what clicking "Log in" does.
function fakePage(
  options: {
    passwordForm?: boolean;
    outcome?: "home" | "stays";
    token?: string;
    tokenAfterNavigation?: boolean;
    settles?: boolean;
    elevation?: { status: number; type: string };
  } = {},
) {
  const calls: string[] = [];
  let url = "about:blank";
  const page: SignInPage = {
    url: () => url,
    goto: async (target) => {
      calls.push(`goto ${target}`);
      url = target;
    },
    waitForSelector: async (selector) => {
      if (options.passwordForm === false) {
        throw new Error(`timeout waiting for ${selector}`);
      }
    },
    fill: async (selector, value) => {
      calls.push(`fill ${selector} ${selector === "#user_password" ? "***" : value}`);
    },
    click: async (selector) => {
      calls.push(`click ${selector}`);
      if ((options.outcome ?? "home") === "home") {
        url = `${BASE}/now/nav/ui/home`;
      }
    },
    waitForURL: async (predicate) => {
      if (!predicate(new URL(url))) {
        throw new Error("timeout waiting for the URL");
      }
    },
    waitForLoadState: async () => {
      if (options.settles === false) {
        throw new Error("timeout waiting for networkidle");
      }
    },
    token: async () => {
      if (options.tokenAfterNavigation === true && !calls.includes("token retried")) {
        calls.push("token retried");
        throw new Error("Execution context was destroyed");
      }
      return options.token ?? "tok123";
    },
    postElevation: async () => {
      calls.push("post elevation");
      return options.elevation ?? { status: 0, type: "opaqueredirect" };
    },
    send: async () => {
      throw new Error("not used");
    },
  };
  return { page, calls };
}

const SETTINGS = { instance: "dev", base: BASE, username: "admin", password: "pw" };

describe("signing in to the login form (ADR-0024)", () => {
  it("fills the form with the profile's user and password, and returns the session token", async () => {
    const { page, calls } = fakePage();
    expect(await signIn(page, SETTINGS)).toBe("tok123");
    expect(calls).toEqual([
      `goto ${BASE}/login.do`,
      "fill #user_name admin",
      "fill #user_password ***",
      "click #sysverb_login",
      expect.stringMatching(/^goto https:\/\/dev1\.service-now\.com\/api\/now\/table\//),
    ]);
  });

  it("refuses a login page without a password form, as single sign-on serves", async () => {
    const { page } = fakePage({ passwordForm: false });
    await expect(signIn(page, SETTINGS)).rejects.toMatchObject({ code: "sign-in-unsupported" });
  });

  it("reports a sign-in that stays on the login page", async () => {
    const { page } = fakePage({ outcome: "stays" });
    await expect(signIn(page, SETTINGS)).rejects.toMatchObject({
      code: "sign-in-failed",
      message: expect.not.stringContaining("pw"),
    });
  });

  it("waits out a landing page that keeps loading or navigating", async () => {
    const { page } = fakePage({ settles: false, tokenAfterNavigation: true });
    expect(await signIn(page, { ...SETTINGS, tokenWaitMs: 1000 })).toBe("tok123");
  });

  it("reports a session without a token", async () => {
    const { page } = fakePage({ token: "" });
    await expect(signIn(page, { ...SETTINGS, tokenWaitMs: 10 })).rejects.toMatchObject({
      code: "sign-in-failed",
    });
  });
});

describe("elevating to security_admin (ADR-0024)", () => {
  it("posts the Elevate dialog's form, and accepts its redirect", async () => {
    const { page, calls } = fakePage();
    await elevate(page, { instance: "dev", base: BASE, token: "tok123" });
    expect(calls).toEqual(["post elevation"]);
  });

  it("refuses an answer that is not the dialog's redirect", async () => {
    const { page } = fakePage({ elevation: { status: 200, type: "basic" } });
    await expect(
      elevate(page, { instance: "dev", base: BASE, token: "tok123" }),
    ).rejects.toMatchObject({ code: "elevation-failed" });
  });
});
