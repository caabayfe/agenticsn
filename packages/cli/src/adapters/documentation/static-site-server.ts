import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
};

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  return TYPES[dot < 0 ? "" : path.slice(dot)] ?? "application/octet-stream";
}

// The file a URL path names inside root, or null when it would leave root or is absent.
export function resolveSitePath(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = normalize(decoded.endsWith("/") ? `${decoded}index.html` : decoded).replace(
    /^[/\\]+/,
    "",
  );
  const target = join(root, relative);
  if (target !== root && !target.startsWith(root.endsWith(sep) ? root : root + sep)) {
    return null;
  }
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

// A local preview of the built site: 127.0.0.1 only, static files only, until cancelled.
export async function serveSite(
  root: string,
  port: number,
  signal: AbortSignal,
  ready: (url: string) => void,
) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("method not allowed", { status: 405 });
      }
      const path = resolveSitePath(root, new URL(request.url).pathname);
      return path === null
        ? new Response("not found", { status: 404 })
        : new Response(Bun.file(path), { headers: { "content-type": contentType(path) } });
    },
  });
  ready(`http://127.0.0.1:${server.port}/`);
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
  await server.stop(true);
}
