import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { selectVisualPlatform } from '../../scripts/visual/platform.mjs';
import type { VisualHostFacts } from '../../scripts/visual/platform.mjs';
import { validateVisualReferences } from '../../scripts/visual/validate.mjs';

const hosted: VisualHostFacts = { githubActions: 'true', runnerEnvironment: 'github-hosted', runnerOS: 'macOS', runnerArch: 'ARM64',
  platform: 'darwin', arch: 'arm64', release: '25.6.0', macosVersion: '26.6.2', node: 'v22.17.0', imageVersion: '20261013.0424.1' };

describe('explicit reviewed visual platform selection', () => {
  it('keeps the original path by default, including on CI', () => {
    expect(selectVisualPlatform(undefined, {})).toEqual(selectVisualPlatform(undefined, hosted));
    expect(selectVisualPlatform(undefined, {}).snapshotPathTemplate).not.toContain('github-macos-26');
  });
  it('uses the separate references only on the approved hosted environment', () => {
    expect(selectVisualPlatform('github-macos-26', hosted).snapshotPathTemplate).toBe('{testDir}/{testFilePath}-snapshots/github-macos-26/{arg}{ext}');
  });
  it.each(['', 'local', 'linux', 'github-macos-27', '../github-macos-26'])('rejects unknown selector %j without falling back', selector => {
    expect(() => selectVisualPlatform(selector, hosted)).toThrow('Unknown visual platform');
  });
  it.each([
    ['githubActions', 'false'], ['runnerEnvironment', 'self-hosted'], ['runnerOS', 'Linux'], ['runnerArch', 'X64'],
    ['platform', 'linux'], ['arch', 'x64'], ['release', '24.6.0'], ['macosVersion', '27.0'], ['node', 'v24.0.0'], ['imageVersion', 'future-image'],
    ['runnerEnvironment', undefined], ['imageVersion', undefined],
  ] as const)('rejects unmatched host %s=%s', (key, value) => {
    expect(() => selectVisualPlatform('github-macos-26', { ...hosted, [key]: value })).toThrow('requires');
  });
});

describe('approved visual reference byte contract', () => {
  const report = validateVisualReferences();
  let root: string;
  const proposal = 'artifacts/beta-launch/platform-reference-proposal.json';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'runner3d-visual-contract-'));
    for (const path of [proposal, ...report.entries.flatMap(row => [row.original, row.platform])]) {
      mkdirSync(dirname(join(root, path)), { recursive: true }); copyFileSync(path, join(root, path));
    }
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it('checks every original and platform hash, all 35 sources and 56 copies', () => {
    expect(report).toMatchObject({ originalCount: 91, platformCount: 91, reviewedActualCount: 35, unchangedCopyCount: 56, allMatched: true });
    expect(report.entries).toHaveLength(91);
    expect(validateVisualReferences(root)).toEqual(report);
  });
  it.each(['original', 'platform'] as const)('rejects even one changed byte in a %s reference', kind => {
    const path = join(root, report.entries[0]![kind]); const original = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([original, Buffer.from([0])]));
      expect(() => validateVisualReferences(root)).toThrow('hash mismatch');
    } finally { writeFileSync(path, original); }
  });
  it('rejects a changed proposal instead of trusting its replacement hashes', () => {
    const path = join(root, proposal), original = readFileSync(path);
    try { writeFileSync(path, Buffer.concat([original, Buffer.from(' ')])); expect(() => validateVisualReferences(root)).toThrow('proposal hash changed'); }
    finally { writeFileSync(path, original); }
  });
  it('rejects an unreviewed future reference', () => {
    const path = join(root, dirname(report.entries[0]!.platform), 'unreviewed.png');
    try { copyFileSync(report.entries[0]!.original, path); expect(() => validateVisualReferences(root)).toThrow('Unexpected reference file'); }
    finally { rmSync(path); }
  });
  it('rejects an extra top-level snapshot symlink before traversing it', () => {
    const target = join(root, 'empty-target'), link = join(root, 'tests/e2e/unreviewed.spec.ts-snapshots');
    mkdirSync(target);
    try { symlinkSync(target, link, 'dir'); expect(() => validateVisualReferences(root)).toThrow('directory/symlink forbidden'); }
    finally { rmSync(link); rmSync(target, { recursive: true }); }
  });
  it('rejects a missing original PNG rather than trusting the paired platform file', () => {
    const path = join(root, report.entries[0]!.original), bytes = readFileSync(path);
    try { rmSync(path); expect(() => validateVisualReferences(root)).toThrow(); }
    finally { writeFileSync(path, bytes); }
  });
  it('rejects a missing platform directory', () => {
    const path = join(root, dirname(report.entries[0]!.platform)), backup = join(root, 'temporarily-removed-platform');
    try { renameSync(path, backup); expect(() => validateVisualReferences(root)).toThrow(); }
    finally { renameSync(backup, path); }
  });
  it('rejects a reference file symlink even when its target is another valid PNG', () => {
    const path = join(root, report.entries[0]!.original), bytes = readFileSync(path);
    try {
      rmSync(path); symlinkSync(join(root, report.entries[1]!.original), path);
      expect(() => validateVisualReferences(root)).toThrow('symlink forbidden');
    } finally { rmSync(path); writeFileSync(path, bytes); }
  });
  it('rejects a nested platform directory symlink', () => {
    const path = join(root, dirname(report.entries[0]!.platform)), backup = join(root, 'temporarily-removed-platform');
    try {
      renameSync(path, backup); symlinkSync(backup, path, 'dir');
      expect(() => validateVisualReferences(root)).toThrow('symlink forbidden');
    } finally { rmSync(path); renameSync(backup, path); }
  });
  it('rejects an unreviewed empty directory in the protected reference tree', () => {
    const path = join(root, dirname(report.entries[0]!.original), 'unreviewed-empty');
    try { mkdirSync(path); expect(() => validateVisualReferences(root)).toThrow(); }
    finally { rmSync(path, { recursive: true }); }
  });
  it('rejects non-PNG additions instead of treating the reference directory as scratch space', () => {
    const path = join(root, dirname(report.entries[0]!.platform), 'unreviewed.json');
    try { writeFileSync(path, '{}'); expect(() => validateVisualReferences(root)).toThrow(); }
    finally { rmSync(path); }
  });
});
