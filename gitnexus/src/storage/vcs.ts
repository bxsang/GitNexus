/**
 * VCS adapter abstraction.
 *
 * The pipeline core is VCS-agnostic; only bootstrap (detection,
 * revision retrieval, remote URL) differs between backends. A
 * polymorphic adapter collapses what would otherwise be repeated
 * `if git else if svn` dispatch at every call site.
 *
 * Detection prefers `.git` over `.svn` at the same level so
 * `git-svn` bridges (which have both) keep their existing git
 * behaviour. Walking ancestors uses the cheap filesystem check
 * (no subprocess), matching `findGitRootByDotGit`.
 */

import path from 'path';
import { statSync } from 'fs';
import { gitAdapter } from './git.js';
import { svnAdapter } from './svn.js';

export type VcsKind = 'git' | 'svn';

export interface VcsAdapter {
  readonly kind: VcsKind;
  /**
   * Whether the underlying VCS CLI is available AND this path is
   * inside a working copy. Mirrors the semantics of `isGitRepo`.
   */
  isAvailable(repoPath: string): boolean;
  /**
   * Opaque revision string for the current working copy state.
   * Returns empty string on failure (matches `getCurrentCommit`).
   * For git this is a SHA; for SVN it is `r<n>`.
   */
  getCurrentRevision(repoPath: string): string;
  /**
   * Canonical remote URL for sibling-clone fingerprinting.
   * `undefined` when there is no remote, the path is not a working
   * copy, or the VCS CLI is unavailable.
   */
  getRemoteUrl(repoPath: string): string | undefined;
  /** Working-copy root for the given path, or `null` if not in one. */
  getRoot(fromPath: string): string | null;
  /**
   * Canonical root used to derive the registry name. For git this
   * dereferences worktrees; for SVN (no worktree concept) it is
   * the same as `getRoot`.
   */
  getCanonicalRoot(fromPath: string): string | null;
}

export const adapters: Record<VcsKind, VcsAdapter> = {
  git: gitAdapter,
  svn: svnAdapter,
};

/**
 * Check ancestors of `fromPath` for a `.git` or `.svn` marker.
 * Returns the matching adapter, preferring `.git` when both are
 * present at the same level. Filesystem-only — does not spawn the
 * VCS CLI, so safe to call before checking adapter availability.
 */
export const detectVcs = (fromPath: string): VcsAdapter | null => {
  let current: string;
  try {
    current = path.resolve(fromPath);
    if (!statSync(current).isDirectory()) {
      current = path.dirname(current);
    }
  } catch {
    return null;
  }

  while (true) {
    if (hasMarker(current, '.git')) return gitAdapter;
    if (hasMarker(current, '.svn')) return svnAdapter;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const hasMarker = (dirPath: string, marker: string): boolean => {
  try {
    statSync(path.join(dirPath, marker));
    return true;
  } catch {
    return false;
  }
};
