import { afterAll, describe, expect, it } from "bun:test";
import { InstanceName, type InstanceProfile } from "@snagentic/core";
import { BrowserElevatedSessions } from "../../../../src/adapters/servicenow/elevation/browser-elevated-sessions";
import type { SignInPage } from "../../../../src/adapters/servicenow/elevation/browser-sign-in";
import { sendFromPage } from "../../../../src/adapters/servicenow/elevation/page-scripts";

// The instance behind the page: answers the session user, and writes unless `refuse` is set.
const state = { refuse: false, requests: [] as string[] };
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    state.requests.push(
      `${request.method} ${url.pathname} token=${request.headers.get("x-usertoken")} auth=${request.headers.get("authorization")}`,
    );
    if (url.pathname === "/api/now/table/sys_user") {
      return Response.json({ result: [{ user_name: "admin" }] });
    }
    if (state.refuse) {
      return Response.json(
        { error: { message: "Operation Failed", detail: "ACL Exception Insert Failed" } },
        { status: 403 },
      );
    }
    return Response.json({ result: { sys_id: "a1", sys_updated_on: "x" } }, { status: 201 });
  },
});
afterAll(() => server.stop(true));

// Profiles accept only https addresses; the local server is plain http.
const profile: InstanceProfile = {
  name: InstanceName.parse("dev"),
  url: server.url.href.replace(/\/$/, ""),
  kind: "development",
  auth: { method: "basic", username: "admin" },
  readOnlyAcknowledged: false,
};

function fakeBrowser(options: { passwordForm?: boolean; failsToClose?: boolean } = {}) {
  const events: string[] = [];
  let url = "about:blank";
  const page: SignInPage = {
    url: () => url,
    goto: async (target) => {
      url = target;
      events.push(`goto ${new URL(target).pathname}`);
      if (options.failsToClose === true && target.endsWith("/logout.do")) {
        throw new Error("navigation failed");
      }
    },
    waitForSelector: async () => {
      if (options.passwordForm === false) {
        throw new Error("timeout");
      }
    },
    fill: async () => {},
    click: async () => {
      url = `${profile.url}/now/nav/ui/home`;
    },
    waitForURL: async () => {},
    waitForLoadState: async () => {},
    token: async () => "tok123",
    postElevation: async () => {
      events.push("elevate");
      return { status: 0, type: "opaqueredirect" };
    },
    send: sendFromPage,
  };
  const launch = async () => ({
    newPage: async () => page,
    close: async () => {
      events.push("browser closed");
      if (options.failsToClose === true) {
        throw new Error("browser already gone");
      }
    },
  });
  return { launch, events };
}

const LIVE = new AbortController().signal;

describe("BrowserElevatedSessions (ADR-0024)", () => {
  it("signs in, elevates, and writes from the page with its token and no password", async () => {
    state.requests = [];
    const browser = fakeBrowser();
    const sessions = new BrowserElevatedSessions(profile, "pw", "test", browser.launch);
    const session = await sessions.open(LIVE);
    expect(session.username).toBe("admin");
    await session.writer.insert("sys_security_acl", { name: "incident" }, LIVE);
    await session.close();
    expect(browser.events).toEqual([
      "goto /login.do",
      "goto /api/now/table/sys_user",
      "elevate",
      "goto /logout.do",
      "browser closed",
    ]);
    expect(state.requests).toEqual([
      "GET /api/now/table/sys_user token=tok123 auth=null",
      "POST /api/now/table/sys_security_acl token=tok123 auth=null",
    ]);
  });

  it("reports a refused write as a failed elevation", async () => {
    state.refuse = true;
    try {
      const sessions = new BrowserElevatedSessions(profile, "pw", "test", fakeBrowser().launch);
      const session = await sessions.open(LIVE);
      await expect(
        session.writer.insert("sys_security_acl", { name: "incident" }, LIVE),
      ).rejects.toMatchObject({ code: "elevation-failed" });
      await expect(
        session.writer.update("sys_security_acl", "a1", { active: "false" }, LIVE),
      ).rejects.toMatchObject({ code: "elevation-failed" });
      await session.close();
    } finally {
      state.refuse = false;
    }
  });

  it("closes the browser when signing in fails", async () => {
    const browser = fakeBrowser({ passwordForm: false });
    const sessions = new BrowserElevatedSessions(profile, "pw", "test", browser.launch);
    await expect(sessions.open(LIVE)).rejects.toMatchObject({ code: "sign-in-unsupported" });
    expect(browser.events.at(-1)).toBe("browser closed");
  });

  it("closes the browser even when signing out fails", async () => {
    const browser = fakeBrowser({ failsToClose: true });
    const session = await new BrowserElevatedSessions(profile, "pw", "test", browser.launch).open(
      LIVE,
    );
    await expect(session.close()).rejects.toThrow("browser already gone");
    expect(browser.events.slice(-2)).toEqual(["goto /logout.do", "browser closed"]);
  });

  it("reports the sign-in failure, not a browser that fails to close", async () => {
    const browser = fakeBrowser({ passwordForm: false, failsToClose: true });
    const sessions = new BrowserElevatedSessions(profile, "pw", "test", browser.launch);
    await expect(sessions.open(LIVE)).rejects.toMatchObject({ code: "sign-in-unsupported" });
  });
});
