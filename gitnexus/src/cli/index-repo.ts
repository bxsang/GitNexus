/**
 * Index Command
 *
 * Registers an existing .gitnexus/ folder into the global registry so the
 * MCP server can discover the repo without running a full `gitnexus analyze`.
 *
 * Useful when a pre-built .gitnexus/ directory is already present (e.g. after
 * cloning a repo that ships its index, restoring from backup, or using a
 * shared team index).
 */

import path from 'path';
import fs from 'fs/promises';
import {
  getStoragePaths,
  loadMeta,
  ensureGitNexusIgnored,
  registerRepo,
} from '../storage/repo-manager.js';
import { detectVcs } from '../storage/vcs.js';

export interface IndexOptions {
  force?: boolean;
  allowNonGit?: boolean;
  /** Alias for `allowNonGit` that also covers `.svn` working copies. */
  allowNonVcs?: boolean;
}

export const indexCommand = async (inputPathParts?: string[], options?: IndexOptions) => {
  console.log('\n  GitNexus Index\n');

  const inputPath = inputPathParts?.length ? inputPathParts.join(' ') : undefined;

  if (inputPathParts && inputPathParts.length > 1) {
    const resolvedCombinedPath = path.resolve(inputPath);
    try {
      await fs.access(resolvedCombinedPath);
    } catch {
      console.log('  The `index` command accepts a single path only.');
      console.log('  If your path contains spaces, wrap it in quotes.');
      console.log(`  Received multiple path parts: ${inputPathParts.join(', ')}`);
      console.log('');
      process.exitCode = 1;
      return;
    }
  }

  const allowNonVcs = !!(options?.allowNonGit || options?.allowNonVcs);

  let repoPath: string;
  if (inputPath) {
    repoPath = path.resolve(inputPath);
  } else {
    const cwdVcs = detectVcs(process.cwd());
    const vcsRoot = cwdVcs?.getRoot(process.cwd()) ?? null;
    if (!vcsRoot) {
      console.log('  Not inside a git or svn working copy, try to run git init\n');
      process.exitCode = 1;
      return;
    }
    repoPath = vcsRoot;
  }

  const detectedVcs = detectVcs(repoPath);
  if (!allowNonVcs && !detectedVcs) {
    console.log(`  Not a git or svn working copy: ${repoPath}`);
    console.log('  Initialize one with `git init` or choose a valid repo path.\n');
    console.log('  Or use --allow-non-vcs to register an existing .gitnexus index anyway.\n');
    process.exitCode = 1;
    return;
  }

  const { storagePath, lbugPath } = getStoragePaths(repoPath);

  // ── Verify .gitnexus/ exists ──────────────────────────────────────
  try {
    await fs.access(storagePath);
  } catch {
    console.log(`  No .gitnexus/ folder found at: ${storagePath}`);
    console.log('  Run `gitnexus analyze` to build the index first.\n');
    process.exitCode = 1;
    return;
  }

  // ── Verify lbug database exists ───────────────────────────────────
  try {
    await fs.access(lbugPath);
  } catch {
    console.log(`  .gitnexus/ folder exists but contains no LadybugDB index.`);
    console.log('  Run `gitnexus analyze` to build the index.\n');
    process.exitCode = 1;
    return;
  }

  // ── Load or reconstruct meta ──────────────────────────────────────
  let meta = await loadMeta(storagePath);

  if (!meta) {
    if (!options?.force) {
      console.log(`  .gitnexus/ exists but meta.json is missing.`);
      console.log('  Use --force to register anyway (stats will be empty),');
      console.log('  or run `gitnexus analyze` to rebuild properly.\n');
      process.exitCode = 1;
      return;
    }

    // --force: build a minimal meta so the repo can be registered
    meta = {
      repoPath,
      lastCommit: '',
      indexedAt: new Date().toISOString(),
    };
  }

  // ── Register in global registry ───────────────────────────────────
  // Refresh the on-disk meta with a freshly captured `remoteUrl` if
  // it's missing, so an `index` of an older `.gitnexus/` still gets
  // sibling-clone fingerprinting on subsequent use without forcing a
  // full re-analyze. Also stamp the `vcsType` so legacy meta.json
  // files (written before SVN support) carry the field forward.
  if (detectedVcs) {
    if (!meta.remoteUrl) {
      meta.remoteUrl = detectedVcs.getRemoteUrl(repoPath);
    }
    if (!meta.vcsType) {
      meta.vcsType = detectedVcs.kind;
    }
  }
  await registerRepo(repoPath, meta);
  await ensureGitNexusIgnored(repoPath);

  const projectName = path.basename(repoPath);
  const { stats } = meta;

  console.log(`  Repository registered: ${projectName}`);
  if (stats) {
    const parts: string[] = [];
    if (stats.nodes != null) {
      parts.push(`${stats.nodes.toLocaleString()} nodes`);
    }
    if (stats.edges != null) {
      parts.push(`${stats.edges.toLocaleString()} edges`);
    }
    if (stats.communities != null) parts.push(`${stats.communities} clusters`);
    if (stats.processes != null) parts.push(`${stats.processes} flows`);
    if (parts.length) console.log(`  ${parts.join(' | ')}`);
  }
  console.log(`  ${repoPath}`);

  console.log('');
};
