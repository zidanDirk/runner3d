import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReleaseInfo } from '../../src/release/config';
import assets from '../../src/assets/generated/manifest.json';

export const releaseInput = { version: '0.14.0-beta', environment: 'preview', commit: 'abcdef1234567890', buildTime: '2026-10-22T01:02:03.000Z' };

export async function fixture(run: (root: string, files: Record<string, { bytes: number; sha256: string }>) => Promise<void>, environment: 'preview' | 'production' = 'preview'): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'runner-release-'));
  try {
    await cp('public/models', join(root, 'models'), { recursive: true });
    await mkdir(join(root, 'assets'));
    const files: Record<string, { bytes: number; sha256: string }> = {};
    for (const asset of Object.values(assets.assets)) files[asset.path] = { bytes: (await readFile(join(root, asset.path))).length, sha256: asset.sha256 };
    const release = createReleaseInfo({ ...releaseInput, environment });
    for (const [path, contents] of Object.entries({ 'index.html': '<script type="module" src="./assets/app.js"></script>', 'assets/app.js': 'console.log("Runner3D")', 'release.json': JSON.stringify(release, null, 2) + '\n' })) {
      await writeFile(join(root, path), contents);
      files[path] = { bytes: Buffer.byteLength(contents), sha256: createHash('sha256').update(contents).digest('hex') };
    }
    await writeFile(join(root, 'release-manifest.json'), JSON.stringify({ schemaVersion: 1, release, files }));
    await run(root, files);
  } finally { await rm(root, { recursive: true, force: true }); }
}

