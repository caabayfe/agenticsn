import { describe, expect, it } from "bun:test";
import {
  type BrowserEngine,
  type BrowserPage,
  installedBrowser,
} from "../../../../src/adapters/servicenow/elevation/installed-browser";

// A page that records what the session asks of it, and runs page functions here.
function recordingPage(calls: string[]): BrowserPage {
  return {
    url: () => "https://dev1.service-now.com/now/nav/ui/home",
    goto: async (url) => calls.push(`goto ${url}`),
    waitForSelector: async (selector) => calls.push(`wait ${selector}`),
    fill: async (selector) => {
      calls.push(`fill ${selector}`);
    },
    click: async (selector) => {
      calls.push(`click ${selector}`);
    },
    waitForURL: async () => {
      calls.push("wait url");
    },
    waitForLoadState: async (state) => {
      calls.push(`load ${state}`);
    },
    evaluate: async (pageFunction, arg) => {
      calls.push(`evaluate ${pageFunction.name}`);
      return pageFunction(arg);
    },
  };
}

function engine(options: { refuse: readonly string[] }) {
  const calls: string[] = [];
  const chromium: BrowserEngine = {
    launch: async ({ channel, headless }) => {
      calls.push(`launch ${channel} headless=${headless}`);
      if (options.refuse.includes(channel)) {
        throw new Error(`${channel} is not installed\nlong playwright log`);
      }
      return {
        newContext: async () => ({ newPage: async () => recordingPage(calls) }),
        close: async () => {
          calls.push("close");
        },
      };
    },
  };
  return { load: async () => chromium, calls };
}

describe("launching the installed browser (ADR-0024)", () => {
  it("starts Chrome headless and drives its page", async () => {
    const { load, calls } = engine({ refuse: [] });
    const browser = await installedBrowser(load)();
    const page = await browser.newPage();
    Reflect.set(globalThis, "g_ck", "tok123");
    try {
      expect(await page.token()).toBe("tok123");
    } finally {
      Reflect.deleteProperty(globalThis, "g_ck");
    }
    expect(page.url()).toContain("/now/nav/ui/home");
    await page.goto("https://dev1.service-now.com/login.do");
    await page.waitForSelector("#user_password", { timeout: 1 });
    await page.fill("#user_name", "admin");
    await page.click("#sysverb_login");
    await page.waitForURL(() => true, { timeout: 1 });
    await page.waitForLoadState("networkidle", { timeout: 1 });
    await browser.close();
    expect(calls).toEqual([
      "launch chrome headless=true",
      "evaluate sessionToken",
      "goto https://dev1.service-now.com/login.do",
      "wait #user_password",
      "fill #user_name",
      "click #sysverb_login",
      "wait url",
      "load networkidle",
      "close",
    ]);
  });

  it("runs the page's requests and the elevation post through the page", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("{}", { status: 200 }),
    });
    try {
      const { load, calls } = engine({ refuse: [] });
      const page = await (await installedBrowser(load)()).newPage();
      const url = `${server.url}x`;
      await page.send({ method: "GET", url, headers: {}, body: null, timeoutMs: 1000 });
      await page.postElevation({ url, token: "t" });
      expect(calls.filter((call) => call.startsWith("evaluate"))).toEqual([
        "evaluate sendFromPage",
        "evaluate postElevation",
      ]);
    } finally {
      server.stop(true);
    }
  });

  it("falls back to Edge when Chrome cannot start", async () => {
    const { load, calls } = engine({ refuse: ["chrome"] });
    await installedBrowser(load)();
    expect(calls).toEqual(["launch chrome headless=true", "launch msedge headless=true"]);
  });

  it("names both browsers, one line each, when neither starts", async () => {
    const { load } = engine({ refuse: ["chrome", "msedge"] });
    await expect(installedBrowser(load)()).rejects.toMatchObject({
      code: "browser-unavailable",
      message: expect.stringContaining(
        "chrome: chrome is not installed; msedge: msedge is not installed",
      ),
    });
  });
});
