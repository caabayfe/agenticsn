import { InvalidInstanceUrlError } from "./errors";

const BARE_INSTANCE_NAME = /^[a-z0-9][a-z0-9-]*$/i;

function parseUrl(text: string, original: string): URL {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new InvalidInstanceUrlError(original, "not a valid address");
  }
}

// Returns the instance's https origin, e.g. "https://dev12345.service-now.com".
export function normalizeInstanceUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new InvalidInstanceUrlError(input, "empty");
  }
  const text = BARE_INSTANCE_NAME.test(trimmed) ? `${trimmed}.service-now.com` : trimmed;
  const url = parseUrl(text, input);
  if (url.protocol !== "https:") {
    throw new InvalidInstanceUrlError(input, "only https is supported");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || url.username !== "") {
    throw new InvalidInstanceUrlError(
      input,
      "use the address of the instance itself, without a path",
    );
  }
  return `https://${url.host}`;
}
