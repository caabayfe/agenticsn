import type { SignInPage } from "./browser-sign-in";
import { BrowserUnavailableError } from "./errors";
import { postElevation, sendFromPage, sessionToken } from "./page-scripts";

// A browser with one throwaway context: no profile on disk, no traces, no screenshots, so the
// session's cookies live only in memory and end with it (ADR-0024).
export interface BrowserHandle {
  newPage(): Promise<SignInPage>;
  close(): Promise<void>;
}

export type BrowserLauncher = () => Promise<BrowserHandle>;

// The part of playwright's Page, Browser and chromium the session drives.
export interface BrowserPage extends Omit<SignInPage, "send" | "token" | "postElevation"> {
  evaluate<R, A>(pageFunction: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

export interface BrowserEngine {
  launch(options: { channel: string; headless: boolean }): Promise<{
    newContext(): Promise<{ newPage(): Promise<BrowserPage> }>;
    close(): Promise<void>;
  }>;
}

const CHANNELS = ["chrome", "msedge"] as const;

function signInPage(page: BrowserPage): SignInPage {
  return {
    url: () => page.url(),
    goto: (url) => page.goto(url),
    waitForSelector: (selector, options) => page.waitForSelector(selector, options),
    fill: (selector, value) => page.fill(selector, value),
    click: (selector) => page.click(selector),
    waitForURL: (predicate, options) => page.waitForURL(predicate, options),
    waitForLoadState: (state, options) => page.waitForLoadState(state, options),
    send: (request) => page.evaluate(sendFromPage, request),
    token: () => page.evaluate(sessionToken, undefined),
    postElevation: (post) => page.evaluate(postElevation, post),
  };
}

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

// The person's installed Chrome, else Edge, headless.
export function installedBrowser(engine: () => Promise<BrowserEngine>): BrowserLauncher {
  return async () => {
    const chromium = await engine();
    const failures: string[] = [];
    for (const channel of CHANNELS) {
      try {
        const browser = await chromium.launch({ channel, headless: true });
        const context = await browser.newContext();
        return {
          newPage: async () => signInPage(await context.newPage()),
          close: () => browser.close(),
        };
      } catch (error) {
        failures.push(`${channel}: ${firstLine(error)}`);
      }
    }
    throw new BrowserUnavailableError(failures.join("; "));
  };
}

// playwright-core is loaded only here, the first time a push needs to elevate, so no other
// command pays for it.
export const launchInstalledBrowser = installedBrowser(
  async () => (await import("playwright-core")).chromium,
);
