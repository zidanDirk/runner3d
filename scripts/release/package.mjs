import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyRelease } from './verify.mjs';

try {
  const report = await verifyRelease('dist');
  await mkdir(resolve('artifacts/beta-release/packages'), { recursive: true });
  const directory = resolve('artifacts/beta-release/packages', report.release.buildId);
  // A release ID cannot silently identify two sets of bytes.
  await mkdir(directory, { recursive: false });
  await cp('dist', resolve(directory, 'site'), { recursive: true, errorOnExist: true, force: false });
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ schemaVersion: 1, ...report }, null, 2) + '\n');
  console.log(`[release:package] ${directory}\nUpload site/ to an immutable releases/${report.release.buildId}/ prefix. No deployment performed.`);
} catch (error) { console.error(`[release:package] ${error instanceof Error ? error.message : 'Failed'}`); process.exitCode = 1; }
