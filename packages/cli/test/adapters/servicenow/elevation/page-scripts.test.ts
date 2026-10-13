import { afterAll, describe, expect, it } from "bun:test";
import {
  postElevation,
  sessionToken,
} from "../../../../src/adapters/servicenow/elevation/page-scripts";

const posted: { path: string; form: Record<string, string> }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const form = Object.fromEntries(new URLSearchParams(await request.text()));
    posted.push({ path: new URL(request.url).pathname, form });
    return new Response(null, { status: 302, headers: { Location: "/now/nav/ui/home" } });
  },
});
afterAll(() => server.stop(true));

// These run inside the signed-in page in production; here they run with the same globals.
describe("page scripts (ADR-0024)", () => {
  it("reads the page's session token, or nothing before the page sets it", () => {
    expect(sessionToken()).toBe("");
    Reflect.set(globalThis, "g_ck", "tok123");
    try {
      expect(sessionToken()).toBe("tok123");
    } finally {
      Reflect.deleteProperty(globalThis, "g_ck");
    }
  });

  it("posts the Elevate dialog's form for security_admin only, without following its redirect", async () => {
    const answer = await postElevation({ url: `${server.url}ui_page_process.do`, token: "tok123" });
    expect(answer.status).toBe(302);
    expect(posted).toEqual([
      {
        path: "/ui_page_process.do",
        form: {
          name: "elevated_role_dialog",
          elevated_roles: "security_admin",
          sysparm_ck: "tok123",
        },
      },
    ]);
  });
});
