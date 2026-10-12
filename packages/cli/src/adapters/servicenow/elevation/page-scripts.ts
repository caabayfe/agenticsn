// Functions that run inside the signed-in browser page (ADR-0024). Each is serialized into the
// page, so it must not refer to anything outside its argument. Running there, every request
// carries the page's session cookie, and with it the session's elevation.

export interface PageRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly timeoutMs: number;
}

export interface PageResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface ElevationPost {
  readonly url: string;
  readonly token: string;
}

export interface ElevationAnswer {
  readonly status: number;
  readonly type: string;
}

// What the session needs from the page: these three functions, run inside it.
export interface PageSession {
  send(request: PageRequest): Promise<PageResponse>;
  token(): Promise<string>;
  postElevation(post: ElevationPost): Promise<ElevationAnswer>;
}

export async function sendFromPage(request: PageRequest): Promise<PageResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === null ? {} : { body: request.body }),
    redirect: "manual",
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return { status: response.status, headers, body: await response.text() };
}

// ServiceNow's session token for requests made from the page (g_ck).
export function sessionToken(): string {
  return String(Reflect.get(globalThis, "g_ck") ?? "");
}

// The form the Elevate dialog (UI page elevated_role_dialog) posts. Its processing script calls
// GlideSecurityManager.enableElevatedRole and redirects.
export async function postElevation(post: ElevationPost): Promise<ElevationAnswer> {
  const form = new URLSearchParams({
    name: "elevated_role_dialog",
    elevated_roles: "security_admin",
    sysparm_ck: post.token,
  });
  const response = await fetch(post.url, { method: "POST", body: form, redirect: "manual" });
  return { status: response.status, type: response.type };
}
