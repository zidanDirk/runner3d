import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReleaseInfo, validateBase } from '../../src/release/config';
import { releaseInfo } from '../../src/release/info';
import { verifyRelease } from '../../scripts/release/verify.mjs';
import assets from '../../src/assets/generated/manifest.json';
import { PROFILE_KEY, ProfileController, defaultProfile } from '../../src/progression';

import { fixture, releaseInput as input } from './release-fixture';
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

it('actual operator CLI blocks unconfirmed uploads/promotions before network or qshell', async () => fixture(async root => {
  const operator = await mkdtemp(join(tmpdir(), 'runner-publish-guard-'));
  try {
    await cp(root, join(operator, 'dist'), { recursive: true });
    const artifact = await verifyRelease(join(operator, 'dist'));
    await mkdir(join(operator, 'artifacts/beta-release/gate'), { recursive: true });
    await writeFile(join(operator, 'artifacts/beta-release/gate/report.json'), JSON.stringify({ status: 'passed', artifact }));
    const script = pathToFileURL(resolve('scripts/release/qiniu.mjs')).href;
    for (const item of [
      { args: ['promote'], confirm: '', approval: 'true', environment: 'production', error: 'Explicit upload/promote --execute required' },
      { args: ['upload', '--execute'], confirm: 'UPLOAD wrong', approval: 'true', environment: 'production', error: 'RELEASE_CONFIRM must name' },
      { args: ['promote', '--execute'], confirm: 'PROMOTE wrong', approval: 'true', environment: 'production', error: 'RELEASE_CONFIRM must name' },
      { args: ['promote', '--execute'], confirm: `PROMOTE ${artifact.release.buildId}`, approval: 'false', environment: 'production', error: 'production required-reviewer approval' },
      { args: ['upload', '--execute'], confirm: `UPLOAD ${artifact.release.buildId}`, approval: 'true', environment: 'preview', error: 'RELEASE_ENV must match' },
      { args: ['upload', '--execute'], confirm: `UPLOAD ${artifact.release.buildId}`, approval: 'false', environment: 'production', error: 'Production candidate uploads remain blocked' },
      { args: ['upload', '--execute'], confirm: `UPLOAD ${artifact.release.buildId}`, approval: 'true', environment: 'production', error: 'Production candidate uploads remain blocked' },
      { args: ['upload', '--execute', '--resume'], confirm: `RESUME ${artifact.release.buildId} ${artifact.manifestSha256}`, approval: 'true', environment: 'production', error: 'Production candidate uploads remain blocked' },
      { args: ['upload', '--execute', '--resume'], confirm: `UPLOAD ${artifact.release.buildId}`, approval: 'true', environment: 'production', error: 'RELEASE_CONFIRM must name' },
      { args: ['upload', '--execute', '--resume'], confirm: `RESUME ${artifact.release.buildId} wronghash`, approval: 'true', environment: 'production', error: 'RELEASE_CONFIRM must name' },
      { args: ['promote', '--execute', '--resume'], confirm: `PROMOTE ${artifact.release.buildId}`, approval: 'true', environment: 'production', error: 'Only upload' },
    ]) {
      // Invoke the real module in a fresh process. A tripwire prevents accidental
      // network access if a guard regresses; PATH cannot find any real qshell.
      const driver = `process.argv=['node','qiniu.mjs',...${JSON.stringify(item.args)}];let calls=0;globalThis.fetch=()=>{calls++;throw Error('UNEXPECTED_NETWORK')};await import(${JSON.stringify(script)});if(calls)console.error('UNEXPECTED_NETWORK');`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
        cwd: operator, encoding: 'utf8', timeout: 5000,
        env: { PATH: '', QINIU_AK: 'synthetic-test-value', QINIU_SK: 'synthetic-test-value', QINIU_BUCKET: 'synthetic-bucket', RELEASE_BASE_URL: 'https://example.invalid/', RELEASE_CONFIRM: item.confirm, RELEASE_APPROVAL_CONFIGURED: item.approval, RELEASE_ENV: item.environment },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(item.error);
      expect(result.stderr).not.toContain('UNEXPECTED_NETWORK');
      expect(result.stdout).not.toMatch(/uploaded|promotion submitted/);
    }
  } finally { await rm(operator, { recursive: true, force: true }); }
}, 'production'));
