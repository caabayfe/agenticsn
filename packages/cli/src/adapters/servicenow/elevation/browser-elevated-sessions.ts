import {
  AccessDeniedError,
  type ElevatedSession,
  type ElevatedSessions,
  type InstanceProfile,
  type InstanceWriter,
  SESSION_USER,
  TableName,
} from "@snagentic/core";
import type { RequestSender } from "../authorization";
import { RequestScheduler } from "../request-scheduler";
import { ServiceNowClient } from "../servicenow-client";
import { elevate, signIn } from "./browser-sign-in";
import { ElevationFailedError } from "./errors";
import { type BrowserLauncher, launchInstalledBrowser } from "./installed-browser";
import { pageTransport } from "./page-transport";

// A refused write in an elevated session means the elevation did not take, not a missing
// role the person could grant from the normal hint.
function elevatedWriter(writer: InstanceWriter, instance: string): InstanceWriter {
  const refused = (error: unknown): never => {
    if (error instanceof AccessDeniedError) {
      throw new ElevationFailedError(instance, `the instance refused the write: ${error.message}`);
    }
    throw error;
  };
  return {
    insert: (table, values, signal) => writer.insert(table, values, signal).catch(refused),
    update: (table, sysId, values, signal) =>
      writer.update(table, sysId, values, signal).catch(refused),
  };
}

// The transport carries the browser session, so requests are not signed again.
const unsigned = (_profile: InstanceProfile, _secret: string, sender: RequestSender) => sender;

async function sessionUser(client: ServiceNowClient, signal: AbortSignal): Promise<string> {
  const rows = await client.query(
    {
      table: TableName.parse("sys_user"),
      query: `sys_id=${SESSION_USER}`,
      fields: ["user_name"],
      limit: 1,
    },
    signal,
  );
  return rows[0]?.["user_name"] ?? "";
}

// ADR-0024: signs in to the login form with the profile's password in a headless browser,
// elevates to security_admin, and writes through REST calls made from that page. Every
// request still goes through a request scheduler. Closing signs out and ends the browser.
export class BrowserElevatedSessions implements ElevatedSessions {
  constructor(
    private readonly profile: InstanceProfile,
    private readonly password: string,
    private readonly version: string,
    private readonly launch: BrowserLauncher = launchInstalledBrowser,
  ) {}

  async open(signal: AbortSignal): Promise<ElevatedSession> {
    signal.throwIfAborted();
    const instance = this.profile.name;
    const base = this.profile.url.replace(/\/$/, "");
    const browser = await this.launch();
    try {
      const page = await browser.newPage();
      const { username } = this.profile.auth;
      const token = await signIn(page, { instance, base, username, password: this.password });
      signal.throwIfAborted();
      await elevate(page, { instance, base, token });
      const scheduler = new RequestScheduler(pageTransport(page, token));
      const client = new ServiceNowClient(this.profile, "", scheduler, this.version, unsigned);
      return {
        username: await sessionUser(client, signal),
        writer: elevatedWriter(client.writer, instance),
        close: async () => {
          await page.goto(`${base}/logout.do`).catch(() => undefined);
          await browser.close();
        },
      };
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }
}
