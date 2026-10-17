const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Standard base64 with padding, for audio embedded in a page as a data URI.
export function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    parts.push(
      ALPHABET[(triple >> 18) & 63] ?? "",
      ALPHABET[(triple >> 12) & 63] ?? "",
      b === undefined ? "=" : (ALPHABET[(triple >> 6) & 63] ?? ""),
      c === undefined ? "=" : (ALPHABET[triple & 63] ?? ""),
    );
  }
  return parts.join("");
}
