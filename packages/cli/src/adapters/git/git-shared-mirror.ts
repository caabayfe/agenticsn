import {
  InstanceName,
  instancePaths,
  type SharedMirror,
  SharedMirrorRewrittenError,
  SharedMirrorUnreachableError,
  type SharedTip,
} from "@snagentic/core";
import { pullStateAt } from "../state/mirror-sync-state-store";
import { moveMirrorBranch } from "./mirror-ref";
import { checkMirrorCommits } from "./mirror-tree-scope";
import { runGit } from "./run-git";

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

function branchOf(instance: string): string {
  return `refs/heads/${instancePaths(InstanceName.parse(instance)).remoteBranch}`;
}

// The remote-tracking ref a fetch updates; the local mirror branch moves only when asked.
function trackingOf(instance: string, remote: string): string {
  return `refs/remotes/${remote}/${instancePaths(InstanceName.parse(instance)).remoteBranch}`;
}

// The shared commit this clone last fetched or published. Only snagentic writes it, so a plain
// `git fetch`, whose default refspec forces remote-tracking refs, cannot move it.
function knownOf(instance: string, remote: string): string {
  return `refs/snagentic/shared/${remote}/${instancePaths(InstanceName.parse(instance)).remoteBranch}`;
}

async function revParse(root: string, ref: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", ref], root);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

// A fetch git refused because the remote tip does not contain the known commit: the shared
// history was replaced.
async function refuseRewritten(root: string, instance: string, remote: string): Promise<void> {
  const last = await revParse(root, knownOf(instance, remote));
  if (last === null) return;
  const listed = await runGit(["ls-remote", remote, branchOf(instance)], root);
  const tip = firstLine(listed.stdout).split("\t")[0] ?? "";
  if (listed.exitCode !== 0 || tip === "") return;
  // Exit code 1 is "not an ancestor"; anything else is git failing, reported as unreachable.
  const builds = await runGit(["merge-base", "--is-ancestor", last, tip], root);
  if (builds.exitCode === 1) throw new SharedMirrorRewrittenError(instance, remote, last, tip);
}

// git fetch and push of servicenow-remote/<name> (ADR-0052). They run like every git command
// snagentic starts: no prompt, and an environment without instance secrets, so git uses the
// developer's own git credentials and nothing else.
export const gitSharedMirror: SharedMirror = {
  // A refspec without "+": git updates the known ref only by fast-forward, so a shared mirror
  // whose history was replaced is refused rather than taken (SEC2-06).
  async fetch(root, instance, remote): Promise<SharedTip | null> {
    const known = knownOf(instance, remote);
    const refspec = `${branchOf(instance)}:${known}`;
    const fetched = await runGit(["fetch", "--quiet", "--no-tags", remote, refspec], root);
    if (fetched.exitCode !== 0) {
      if (/couldn't find remote ref/i.test(fetched.stderr)) {
        await runGit(["update-ref", "-d", trackingOf(instance, remote)], root);
        return null;
      }
      await refuseRewritten(root, instance, remote);
      throw new SharedMirrorUnreachableError(remote, firstLine(fetched.stderr));
    }
    const commit = await revParse(root, known);
    if (commit === null) return null;
    await runGit(["update-ref", trackingOf(instance, remote), commit], root);
    return { commit, state: await pullStateAt(root, commit, InstanceName.parse(instance)) };
  },

  lastFetched(root, instance, remote) {
    return revParse(root, knownOf(instance, remote));
  },

  localTip(root, instance) {
    return revParse(root, branchOf(instance));
  },

  async contains(root, descendant, ancestor) {
    const result = await runGit(["merge-base", "--is-ancestor", ancestor, descendant], root);
    return result.exitCode === 0;
  },

  // The shared tip becomes this clone's mirror, which every later pull builds on and integrate
  // merges: it must hold only what a pull writes. The local tip was checked when it arrived (or
  // written by a pull here), so only what the shared tip changes since then is listed; the whole
  // tree only when there is no local tip.
  async moveTo(root, instance, move) {
    await checkMirrorCommits(root, instance, { from: move.expected, to: move.commit });
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
      await runGit(["update-ref", knownOf(instance, remote), commit], root);
      return "published";
    }
    if (/\[rejected\]|non-fast-forward|fetch first/.test(`${pushed.stdout}\n${pushed.stderr}`)) {
      return "rejected";
    }
    throw new SharedMirrorUnreachableError(remote, firstLine(pushed.stderr));
  },
};
