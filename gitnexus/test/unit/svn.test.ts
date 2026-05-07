/**
 * Unit Tests: SVN adapter (storage/svn.ts)
 *
 * Mocks `child_process.execSync` to drive the regex parsing of
 * `svn info --xml --non-interactive` output without requiring an SVN
 * installation. Filesystem-marker checks (`hasSvnDir`, ancestor walk)
 * use real temp directories.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<info>
<entry kind="dir" path="." revision="42">
  <url>svn://example.com/repo/trunk</url>
  <relative-url>^/trunk</relative-url>
  <repository>
    <root>svn://example.com/repo</root>
    <uuid>abc-123</uuid>
  </repository>
  <wc-info>
    <wcroot-abspath>/work/checkout</wcroot-abspath>
    <schedule>normal</schedule>
    <depth>infinity</depth>
  </wc-info>
  <commit revision="42">
    <author>alice</author>
    <date>2026-01-01T00:00:00Z</date>
  </commit>
</entry>
</info>`;

describe('svn adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCurrentSvnRevision', () => {
    it('extracts revision from <commit revision="N">', async () => {
      mockExecSync.mockReturnValueOnce(Buffer.from(SAMPLE_XML));
      const { getCurrentSvnRevision } = await import('../../src/storage/svn.js');
      expect(getCurrentSvnRevision('/work/checkout')).toBe('r42');
    });

    it('returns empty string when svn info fails', async () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('not a working copy');
      });
      const { getCurrentSvnRevision } = await import('../../src/storage/svn.js');
      expect(getCurrentSvnRevision('/not-a-wc')).toBe('');
    });

    it('returns empty string when XML lacks a <commit> tag', async () => {
      mockExecSync.mockReturnValueOnce(Buffer.from('<info><entry/></info>'));
      const { getCurrentSvnRevision } = await import('../../src/storage/svn.js');
      expect(getCurrentSvnRevision('/work/checkout')).toBe('');
    });
  });

  describe('getSvnRemoteUrl', () => {
    it('extracts and trims the repository <root> URL', async () => {
      mockExecSync.mockReturnValueOnce(Buffer.from(SAMPLE_XML));
      const { getSvnRemoteUrl } = await import('../../src/storage/svn.js');
      expect(getSvnRemoteUrl('/work/checkout')).toBe('svn://example.com/repo');
    });

    it('strips a trailing slash so URLs collapse', async () => {
      const xml = SAMPLE_XML.replace(
        '<root>svn://example.com/repo</root>',
        '<root>svn://example.com/repo/</root>',
      );
      mockExecSync.mockReturnValueOnce(Buffer.from(xml));
      const { getSvnRemoteUrl } = await import('../../src/storage/svn.js');
      expect(getSvnRemoteUrl('/work/checkout')).toBe('svn://example.com/repo');
    });

    it('returns undefined when svn info fails', async () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });
      const { getSvnRemoteUrl } = await import('../../src/storage/svn.js');
      expect(getSvnRemoteUrl('/work/checkout')).toBeUndefined();
    });
  });

  describe('hasSvnDir / findSvnRootByDotSvn', () => {
    it('detects .svn entry on real filesystem', async () => {
      const { hasSvnDir, findSvnRootByDotSvn } = await import('../../src/storage/svn.js');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitnexus-svn-test-'));
      try {
        const wc = path.join(tmpDir, 'wc');
        const sub = path.join(wc, 'src');
        fs.mkdirSync(sub, { recursive: true });
        fs.mkdirSync(path.join(wc, '.svn'));
        expect(hasSvnDir(wc)).toBe(true);
        expect(hasSvnDir(sub)).toBe(false);
        expect(findSvnRootByDotSvn(sub)).toBe(path.resolve(wc));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns null when no .svn ancestor exists', async () => {
      const { findSvnRootByDotSvn } = await import('../../src/storage/svn.js');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitnexus-svn-test-'));
      try {
        expect(findSvnRootByDotSvn(tmpDir)).toBe(null);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('svnAdapter shape', () => {
    it('exposes kind === "svn" and the expected method surface', async () => {
      const { svnAdapter } = await import('../../src/storage/svn.js');
      expect(svnAdapter.kind).toBe('svn');
      expect(typeof svnAdapter.isAvailable).toBe('function');
      expect(typeof svnAdapter.getCurrentRevision).toBe('function');
      expect(typeof svnAdapter.getRemoteUrl).toBe('function');
      expect(typeof svnAdapter.getRoot).toBe('function');
      expect(typeof svnAdapter.getCanonicalRoot).toBe('function');
    });
  });
});
