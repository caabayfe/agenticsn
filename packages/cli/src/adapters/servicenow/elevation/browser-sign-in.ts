import { ElevationFailedError, SignInFailedError, SignInUnsupportedError } from "./errors";
import type { PageSession } from "./page-scripts";

// The part of a browser page signing in needs (playwright's Page has all of it).
export interface SignInPage extends PageSession {
  url(): string;
  goto(url: string): Promise<unknown>;
  waitForSelector(selector: string, options: { readonly timeout: number }): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  waitForURL(
    predicate: (url: URL) => boolean,
    options: { readonly timeout: number },
  ): Promise<void>;
  waitForLoadState(state: "networkidle", options: { readonly timeout: number }): Promise<void>;
}

export interface SignInSettings {
  readonly instance: string;
  readonly base: string;
  readonly username: string;
  readonly password: string;
  readonly tokenWaitMs?: number;
}

const FORM_WAIT_MS = 15_000;
const SIGN_IN_WAIT_MS = 60_000;

async function waitForToken(page: SignInPage, waitMs: number): Promise<string> {
  const until = Date.now() + waitMs;
  do {
    // The landing page can still navigate, which destroys the page's context mid-call.
    const token = await page.token().catch(() => "");
    if (token !== "") {
      return token;
    }
    await Bun.sleep(Math.min(500, waitMs));
  } while (Date.now() < until);
  return "";
}

// Signs in through the login form, waits for the redirects after it to settle, and returns the
// session token. The page then rests on a JSON answer: it runs no script and never navigates,
// so requests made from it cannot be cut off. The password is never logged or reported.
export async function signIn(page: SignInPage, settings: SignInSettings): Promise<string> {
  await page.goto(`${settings.base}/login.do`);
  try {
    await page.waitForSelector("#user_password", { timeout: FORM_WAIT_MS });
  } catch {
    throw new SignInUnsupportedError(settings.instance);
  }
  await page.fill("#user_name", settings.username);
  await page.fill("#user_password", settings.password);
  await page.click("#sysverb_login");
  try {
    await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: SIGN_IN_WAIT_MS });
  } catch {
    throw new SignInFailedError(settings.instance, "the login page did not accept the password");
  }
  await page.waitForLoadState("networkidle", { timeout: SIGN_IN_WAIT_MS }).catch(() => undefined);
  const token = await waitForToken(page, settings.tokenWaitMs ?? 30_000);
  if (token === "") {
    throw new SignInFailedError(settings.instance, "the signed-in page has no session token");
  }
  await page.goto(`${settings.base}/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id`);
  return token;
}

// One request: elevates the session to security_admin only, never other elevated roles.
export async function elevate(
  page: Pick<PageSession, "postElevation">,
  settings: { readonly instance: string; readonly base: string; readonly token: string },
): Promise<void> {
  const answer = await page.postElevation({
    url: `${settings.base}/ui_page_process.do`,
    token: settings.token,
  });
  const redirected =
    answer.type === "opaqueredirect" || (answer.status >= 300 && answer.status < 400);
  if (!redirected) {
    throw new ElevationFailedError(
      settings.instance,
      `the elevation form answered ${answer.status} instead of redirecting`,
    );
  }
}
