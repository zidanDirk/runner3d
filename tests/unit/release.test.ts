import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReleaseInfo, validateBase } from '../../src/release/config';
import { releaseInfo } from '../../src/release/info';
import { verifyRelease } from '../../scripts/release/verify.mjs';
import assets from '../../src/assets/generated/manifest.json';
import { PROFILE_KEY, ProfileController, defaultProfile } from '../../src/progression';

const input = { version: '0.14.0-beta', environment: 'preview', commit: 'abcdef1234567890', buildTime: '2026-10-22T01:02:03.000Z' };
describe('public release identity and environment', () => {
  it('uses explicit validated public fields and a unique time/SHA build ID', () => {
    const info = createReleaseInfo(input);
    expect(info).toEqual({ ...input, buildId: '0.14.0-beta-abcdef123456-20261022T010203000Z' });
    expect(Object.isFrozen(info)).toBe(true);
    expect(releaseInfo.version).toBe('0.14.0-beta');
    expect(createReleaseInfo({ ...input, environment: 'production', buildId: 'candidate-14' }).environment).toBe('production');
  });
  it.each([
    { environment: 'e2e' }, { environment: '' }, { version: 'beta' }, { commit: 'email@example.com' },
    { buildTime: 'yesterday' }, { buildId: '../previous' }, { buildId: 'secret?token=x' }, { buildId: 'a'.repeat(121) },
  ])('rejects unsafe or ambiguous configuration %j', bad => expect(() => createReleaseInfo({ ...input, ...bad })).toThrow());
  it('accepts a static subdirectory and rejects domains/query/traversal bases', () => {
    for (const base of ['./', '/', '/runner/', '/beta/releases/id/']) expect(validateBase(base)).toBe(base);
    for (const base of ['https://example.com/', '//other/', '/../', '/runner/?token=x', 'runner/', '/runner']) expect(() => validateBase(base)).toThrow();
  });
});

async function fixture(run: (root: string, files: Record<string, { bytes: number; sha256: string }>) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'runner-release-'));
  try {
    await cp('public/models', join(root, 'models'), { recursive: true });
    await mkdir(join(root, 'assets'));
    const files: Record<string, { bytes: number; sha256: string }> = {};
    for (const asset of Object.values(assets.assets)) files[asset.path] = { bytes: (await readFile(join(root, asset.path))).length, sha256: asset.sha256 };
    const release = createReleaseInfo(input);
    for (const [path, contents] of Object.entries({ 'index.html': '<script type="module" src="./assets/app.js"></script>', 'assets/app.js': 'console.log("Runner3D")', 'release.json': JSON.stringify(release, null, 2) + '\n' })) {
      await writeFile(join(root, path), contents);
      files[path] = { bytes: Buffer.byteLength(contents), sha256: createHash('sha256').update(contents).digest('hex') };
    }
    await writeFile(join(root, 'release-manifest.json'), JSON.stringify({ schemaVersion: 1, release, files }));
    await run(root, files);
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe('release artifact/cache consistency', () => {
  it('verifies every actual static byte and all committed GLB identities', async () => fixture(async root => {
    expect(await verifyRelease(root)).toMatchObject({ release: { environment: 'preview' }, glbs: 15, fileCount: 18 });
  }));
  it('rejects stale JS, extra/missing files and tampered release identity', async () => fixture(async root => {
    await writeFile(join(root, 'assets/app.js'), 'old cached content');
    await expect(verifyRelease(root)).rejects.toThrow('integrity mismatch');
    await rm(join(root, 'assets/app.js'));
    await expect(verifyRelease(root)).rejects.toThrow('Unexpected or missing');
    await writeFile(join(root, 'release.json'), '{}');
    await expect(verifyRelease(root)).rejects.toThrow('metadata/manifest mismatch');
  }));
  it('rejects mixed-version GLBs even when the delivery file map was rewritten', async () => fixture(async (root, files) => {
    const path = assets.assets.roadblock.path;
    const bytes = Buffer.from('different model version');
    await writeFile(join(root, path), bytes);
    files[path] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(join(root, 'release-manifest.json'), JSON.stringify({ schemaVersion: 1, release: createReleaseInfo(input), files }));
    await expect(verifyRelease(root)).rejects.toThrow('Built GLB differs');
  }));
});

describe('rollback preserves the real schema contract', () => {
  it('reads the current schema without losing wallet/upgrades and protects future schema bytes', () => {
    const storage = new Map<string, string>();
    const current = { ...defaultProfile(), walletCoins: 321, upgrades: { magnet: 1, shield: 0, 'double-score': 0 } };
    storage.set(PROFILE_KEY, JSON.stringify(current));
    const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
    const controller = new ProfileController(adapter);
    expect(controller.snapshot.walletCoins).toBe(321); expect(controller.snapshot.upgrades.magnet).toBe(1);
    const future = '{"schemaVersion":2,"walletCoins":9999,"futureData":"preserve"}';
    storage.set(PROFILE_KEY, future);
    const rolledBack = new ProfileController(adapter); rolledBack.flush();
    expect(storage.get(PROFILE_KEY)).toBe(future); expect(rolledBack.snapshot.walletCoins).toBe(0);
  });
});
