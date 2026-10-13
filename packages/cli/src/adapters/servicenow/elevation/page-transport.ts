import type { Transport } from "../http-types";
import type { PageSession } from "./page-scripts";

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const stop = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) {
      stop();
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}

// ADR-0024: requests made from inside an elevated browser session. The session is the
// credential, so no Authorization header is ever sent; the page's token (g_ck) proves the
// request comes from the session. The request scheduler wraps it like any transport.
export function pageTransport(
  page: Pick<PageSession, "send">,
  token: string,
  settings: { readonly timeoutMs?: number } = {},
): Transport {
  const timeoutMs = settings.timeoutMs ?? 90_000;
  return async (request, signal) => {
    const { Authorization: _dropped, ...headers } = request.headers;
    const sent = page.send({
      method: request.method,
      url: request.url,
      headers: { ...headers, "X-UserToken": token },
      body: request.body ?? null,
      timeoutMs,
    });
    const reply = await Promise.race([sent, aborted(signal)]);
    return {
      status: reply.status,
      headers: { get: (name) => reply.headers[name.toLowerCase()] ?? null },
      text: async () => reply.body,
    };
  };
}
