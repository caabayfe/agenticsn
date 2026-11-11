import {
  hasMirrorAttributes,
  MIRROR_ATTRIBUTES_RULE,
  type WorkspaceFiles,
} from "../../workspace/index";
import type { Check } from "../domain/check";

const NAME = "mirror-line-endings";

// Whether the workspace's .gitattributes checks the mirror out byte for byte. Workspaces created
// before init wrote the rule lack it. doctor reports it rather than adding it: .gitattributes is
// a committed file the team shares, and adding the rule to a Windows clone checked out with CRLF
// shows every mirror file as modified until it is checked out again (spec 014, 1b-L).
export async function checkMirrorAttributes(
  files: Pick<WorkspaceFiles, "read">,
  root: string,
): Promise<Check> {
  if (hasMirrorAttributes(await files.read(`${root}/.gitattributes`))) {
    const detail = `.gitattributes has ${MIRROR_ATTRIBUTES_RULE}`;
    return { name: NAME, status: "ok", detail, hint: null };
  }
  return {
    name: NAME,
    status: "warn",
    detail: `.gitattributes lacks ${MIRROR_ATTRIBUTES_RULE}: with core.autocrlf the mirror is checked out with CRLF`,
    hint:
      `add the line "${MIRROR_ATTRIBUTES_RULE}" to the workspace's .gitattributes and commit only ` +
      "that file; then, in a clone already checked out with CRLF, run " +
      "git rm -r --cached -q instances && git checkout HEAD -- instances " +
      "(docs/guides/team-mode.md, Line endings)",
  };
}
