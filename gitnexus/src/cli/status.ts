/**
 * Status Command
 *
 * Shows the indexing status of the current repository.
 */

import { findRepo, getStoragePaths, hasKuzuIndex } from '../storage/repo-manager.js';
import { detectVcs } from '../storage/vcs.js';

export const statusCommand = async () => {
  const cwd = process.cwd();

  const vcs = detectVcs(cwd);
  if (!vcs) {
    console.log('Not a git or svn working copy.');
    return;
  }

  const repo = await findRepo(cwd);
  if (!repo) {
    // Check if there's a stale KuzuDB index that needs migration
    const repoRoot = vcs.getRoot(cwd) ?? cwd;
    const { storagePath } = getStoragePaths(repoRoot);
    if (await hasKuzuIndex(storagePath)) {
      console.log('Repository has a stale KuzuDB index from a previous version.');
      console.log('Run: gitnexus analyze   (rebuilds the index with LadybugDB)');
    } else {
      console.log('Repository not indexed.');
      console.log('Run: gitnexus analyze');
    }
    return;
  }

  const currentCommit = vcs.getCurrentRevision(repo.repoPath);
  const isUpToDate = currentCommit === repo.meta.lastCommit;
  // Indexed-meta vcsType wins (records what the index was actually
  // built against); fall back to live detection for legacy meta.json
  // written before SVN support landed.
  const recordedVcs = repo.meta.vcsType ?? vcs.kind;
  const truncate = (rev: string | undefined) =>
    !rev ? '' : recordedVcs === 'git' ? rev.slice(0, 7) : rev;

  console.log(`Repository: ${repo.repoPath}`);
  console.log(`VCS: ${recordedVcs}`);
  console.log(`Indexed: ${new Date(repo.meta.indexedAt).toLocaleString()}`);
  console.log(`Indexed revision: ${truncate(repo.meta.lastCommit)}`);
  console.log(`Current revision: ${truncate(currentCommit)}`);
  console.log(`Status: ${isUpToDate ? '✅ up-to-date' : '⚠️ stale (re-run gitnexus analyze)'}`);
};
