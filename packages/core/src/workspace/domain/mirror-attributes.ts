// The mirror is checked out byte for byte on every platform: with core.autocrlf=true (the Windows
// default) git would otherwise check scripts out with CRLF, and an edit pushed from there would
// send CRLF to the instance (spec 014, 1b-L). Hashes don't depend on it: canonicalText already
// reads CRLF as LF.
export const MIRROR_ATTRIBUTES_RULE = "instances/** -text";

const COMMENT = "# snagentic: check the mirror out byte for byte, never with CRLF line endings.";

const PATTERNS = new Set(["instances/**", "/instances/**"]);

// Whether .gitattributes checks the mirror out unconverted: git applies the last line that
// matches, so the last line for the mirror's pattern must unset text (or mark it binary).
export function hasMirrorAttributes(gitattributes: string | null): boolean {
  let unconverted = false;
  for (const line of (gitattributes ?? "").split(/\r?\n/)) {
    const [pattern, ...attributes] = line.trim().split(/\s+/);
    if (pattern !== undefined && PATTERNS.has(pattern)) {
      unconverted = attributes.includes("-text") || attributes.includes("binary");
    }
  }
  return unconverted;
}

// .gitattributes with the mirror rule appended, keeping every other line and the file's own
// line endings; unchanged when it already has it.
export function withMirrorAttributes(gitattributes: string | null): string {
  if (gitattributes === null || gitattributes === "") {
    return `${COMMENT}\n${MIRROR_ATTRIBUTES_RULE}\n`;
  }
  if (hasMirrorAttributes(gitattributes)) {
    return gitattributes;
  }
  const eol = gitattributes.includes("\r\n") ? "\r\n" : "\n";
  const separator = gitattributes.endsWith("\n") ? "" : eol;
  return `${gitattributes}${separator}${COMMENT}${eol}${MIRROR_ATTRIBUTES_RULE}${eol}`;
}
