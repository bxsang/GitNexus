/**
 * SVN adapter — read-only support for full re-index every run.
 *
 * Mirrors the shape of `git.ts` exports for the operations the
 * pipeline cares about. No incremental diff, no MCP detect_changes,
 * no fresh checkout from URL — those are explicit non-goals of the
 * minimal SVN MVP.
 *
 * `svn info --xml --non-interactive` is the only subprocess call.
 * `--xml` keeps tag names locale-stable; `--non-interactive` stops
 * headless runs from hanging on auth prompts. The output is small
 * and the field shapes are stable, so a regex parse avoids pulling
 * in an XML dependency the rest of the codebase does not need.
 */

import { execSync } from 'child_process';
import { statSync } from 'fs';
import path from 'path';
import type { VcsAdapter } from './vcs.js';

export const isSvnRepo = (repoPath: string): boolean => {
  if (!hasSvnDir(repoPath)) return false;
  try {
    execSync('svn --version --quiet', { cwd: repoPath, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export const hasSvnDir = (dirPath: string): boolean => {
  try {
    statSync(path.join(dirPath, '.svn'));
    return true;
  } catch {
    return false;
  }
};

const runSvnInfo = (cwd: string): string | null => {
  try {
    return execSync('svn info --xml --non-interactive', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    return null;
  }
};

export const getCurrentSvnRevision = (repoPath: string): string => {
  const xml = runSvnInfo(repoPath);
  if (!xml) return '';
  // <commit revision="42"> is the last-changed commit on the working copy.
  const match = xml.match(/<commit\s+[^>]*revision="(\d+)"/);
  return match ? `r${match[1]}` : '';
};

export const getSvnRemoteUrl = (repoPath: string): string | undefined => {
  const xml = runSvnInfo(repoPath);
  if (!xml) return undefined;
  const match = xml.match(/<root>([^<]+)<\/root>/);
  if (!match) return undefined;
  // Strip a trailing slash to mirror git's normalisation, so
  // `svn://host/repo` and `svn://host/repo/` collapse.
  return match[1].trim().replace(/\/+$/, '');
};

/**
 * Working-copy root for the given path. Uses `<wcroot-abspath>` from
 * `svn info`, which correctly handles sub-path checkouts (where an
 * ancestor walk would stop too early at a nested `.svn`).
 */
export const getSvnRoot = (fromPath: string): string | null => {
  const resolved = path.resolve(fromPath);
  if (!findSvnRootByDotSvn(resolved)) return null;
  const xml = runSvnInfo(resolved);
  if (!xml) return null;
  const match = xml.match(/<wcroot-abspath>([^<]+)<\/wcroot-abspath>/);
  if (!match) return null;
  return path.resolve(match[1].trim());
};

/**
 * Filesystem-only ancestor walk for a `.svn` marker. Used as a
 * cheap pre-check before shelling out to `svn info`.
 */
export const findSvnRootByDotSvn = (fromPath: string): string | null => {
  let current = path.resolve(fromPath);
  try {
    if (!statSync(current).isDirectory()) {
      current = path.dirname(current);
    }
  } catch {
    return null;
  }
  while (true) {
    if (hasSvnDir(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

export const svnAdapter: VcsAdapter = {
  kind: 'svn',
  isAvailable: isSvnRepo,
  getCurrentRevision: getCurrentSvnRevision,
  getRemoteUrl: getSvnRemoteUrl,
  getRoot: (p) => getSvnRoot(p) ?? findSvnRootByDotSvn(p),
  // SVN has no worktrees — the canonical root is the working copy root.
  getCanonicalRoot: (p) => getSvnRoot(p) ?? findSvnRootByDotSvn(p),
};
