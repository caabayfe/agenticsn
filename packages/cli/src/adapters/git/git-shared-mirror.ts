import {
  InstanceName,
  instancePaths,
  type SharedMirror,
  SharedMirrorUnreachableError,
  type SharedTip,
} from "@snagentic/core";
import { pullStateAt } from "../state/mirror-sync-state-store";
import { moveMirrorBranch } from "./mirror-ref";
import { runGit, runGitOrThrow } from "./run-git";

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

function branchOf(instance: string): string {
  return `refs/heads/${instancePaths(InstanceName.parse(instance)).remoteBranch}`;
}

// The remote-tracking ref a fetch updates; the local mirror branch moves only when asked.
function trackingOf(instance: string, remote: string): string {
  return `refs/remotes/${remote}/${instancePaths(InstanceName.parse(instance)).remoteBranch}`;
}

async function revParse(root: string, ref: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", ref], root);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

// git fetch and push of servicenow-remote/<name> (ADR-0052). They run like every git command
// snagentic starts: no prompt, and an environment without instance secrets, so git uses the
// developer's own git credentials and nothing else.
export const gitSharedMirror: SharedMirror = {
  async fetch(root, instance, remote): Promise<SharedTip | null> {
    const tracking = trackingOf(instance, remote);
    const refspec = `+${branchOf(instance)}:${tracking}`;
    const fetched = await runGit(["fetch", "--quiet", "--no-tags", remote, refspec], root);
    if (fetched.exitCode !== 0) {
      if (!/couldn't find remote ref/i.test(fetched.stderr)) {
        throw new SharedMirrorUnreachableError(remote, firstLine(fetched.stderr));
      }
      await runGit(["update-ref", "-d", tracking], root);
      return null;
    }
    const commit = await revParse(root, tracking);
    if (commit === null) return null;
    return { commit, state: await pullStateAt(root, commit, InstanceName.parse(instance)) };
  },

  localTip(root, instance) {
    return revParse(root, branchOf(instance));
  },

  async contains(root, descendant, ancestor) {
    const result = await runGit(["merge-base", "--is-ancestor", ancestor, descendant], root);
    return result.exitCode === 0;
  },

  async moveTo(root, instance, move) {
    await moveMirrorBranch(root, instance, { ref: branchOf(instance), ...move });
  },

  // Never forced: the remote refuses anything but a fast-forward.
  async publish(root, instance, remote, commit) {
    const pushed = await runGit(
      ["push", "--porcelain", remote, `${commit}:${branchOf(instance)}`],
      root,
    );
    if (pushed.exitCode === 0) {
      await runGit(["update-ref", trackingOf(instance, remote), commit], root);
      return "published";
    }
    if (/\[rejected\]|non-fast-forward|fetch first/.test(`${pushed.stdout}\n${pushed.stderr}`)) {
      return "rejected";
    }
    throw new SharedMirrorUnreachableError(remote, firstLine(pushed.stderr));
  },
};
