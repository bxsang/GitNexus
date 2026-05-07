/**
 * Unit Tests: VCS detection (storage/vcs.ts)
 *
 * Uses real temp directories so the ancestor-walk logic is exercised
 * end-to-end. The adapter functions themselves are mocked in
 * git.test.ts and svn.test.ts; here we only assert which adapter
 * `detectVcs` selects for each tree shape.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// child_process is mocked because importing the svn adapter eagerly
// would otherwise risk shelling out during a `isAvailable` probe in
// some environments. detectVcs itself is filesystem-only.
vi.mock('child_process', () => ({
  execSync: vi.fn(() => Buffer.from('')),
  execFileSync: vi.fn(() => Buffer.from('')),
}));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gitnexus-vcs-detect-'));

describe('detectVcs', () => {
  it('returns null when neither marker exists in any ancestor', async () => {
    const { detectVcs } = await import('../../src/storage/vcs.js');
    const tmp = mkTmp();
    try {
      expect(detectVcs(tmp)).toBe(null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns the git adapter when only .git is present', async () => {
    const { detectVcs } = await import('../../src/storage/vcs.js');
    const tmp = mkTmp();
    try {
      fs.mkdirSync(path.join(tmp, '.git'));
      const adapter = detectVcs(tmp);
      expect(adapter?.kind).toBe('git');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns the svn adapter when only .svn is present', async () => {
    const { detectVcs } = await import('../../src/storage/vcs.js');
    const tmp = mkTmp();
    try {
      fs.mkdirSync(path.join(tmp, '.svn'));
      const adapter = detectVcs(tmp);
      expect(adapter?.kind).toBe('svn');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('prefers git when both markers exist at the same level (git-svn bridges)', async () => {
    const { detectVcs } = await import('../../src/storage/vcs.js');
    const tmp = mkTmp();
    try {
      fs.mkdirSync(path.join(tmp, '.git'));
      fs.mkdirSync(path.join(tmp, '.svn'));
      const adapter = detectVcs(tmp);
      expect(adapter?.kind).toBe('git');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('walks ancestors and finds the nearest marker', async () => {
    const { detectVcs } = await import('../../src/storage/vcs.js');
    const tmp = mkTmp();
    try {
      const sub = path.join(tmp, 'a', 'b', 'c');
      fs.mkdirSync(sub, { recursive: true });
      fs.mkdirSync(path.join(tmp, '.svn'));
      const adapter = detectVcs(sub);
      expect(adapter?.kind).toBe('svn');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('picks the nearest marker when ancestors have a different VCS', async () => {
    const { detectVcs } = await import('../../src/storage/vcs.js');
    const tmp = mkTmp();
    try {
      fs.mkdirSync(path.join(tmp, '.svn'));
      const inner = path.join(tmp, 'inner');
      fs.mkdirSync(path.join(inner, '.git'), { recursive: true });
      // Calling from inside `inner` finds .git at `inner/`, not the
      // outer .svn — the ancestor walk stops at the first match.
      const adapter = detectVcs(inner);
      expect(adapter?.kind).toBe('git');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
