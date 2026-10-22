import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = path => typeof path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').some(part => part === '..' || !part);

/** Verify the built bytes, not merely the existence of a build directory. */
export async function verifyRelease(directory = 'dist') {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(resolve(root, 'release-manifest.json'), 'utf8'));
  const release = JSON.parse(await readFile(resolve(root, 'release.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || JSON.stringify(manifest.release) !== JSON.stringify(release)) throw new Error('Release metadata/manifest mismatch');
  const fields = ['version', 'buildId', 'commit', 'buildTime', 'environment'];
  if (Object.keys(release).length !== fields.length || fields.some(field => typeof release[field] !== 'string') ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version) || !/^(?:[a-f0-9]{7,40}|unknown)$/.test(release.commit) ||
    !Number.isFinite(Date.parse(release.buildTime)) || new Date(release.buildTime).toISOString() !== release.buildTime ||
    !['preview', 'production'].includes(release.environment) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(release.buildId)) throw new Error('Not a deployable release');
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw new Error('Missing release file map');
  const actual = [];
  const visit = async directory => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isSymbolicLink()) throw new Error('Release must not contain symlinks');
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) actual.push(relative(root, path).split('\\').join('/'));
    }
  };
  await visit(root);
  actual.sort();
  const declared = Object.keys(manifest.files).sort();
  if (JSON.stringify(actual.filter(path => path !== 'release-manifest.json')) !== JSON.stringify(declared)) throw new Error('Unexpected or missing release files');
  for (const [path, entry] of Object.entries(manifest.files)) {
    if (!safePath(path) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid file entry');
    const bytes = await readFile(resolve(root, path));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Release integrity mismatch: ${path}`);
  }
  const assets = JSON.parse(await readFile(new URL('../../src/assets/generated/manifest.json', import.meta.url), 'utf8'));
  for (const [id, asset] of Object.entries(assets.assets)) {
    const entry = manifest.files[asset.path];
    if (!entry || entry.sha256 !== asset.sha256) throw new Error(`Built GLB differs from committed manifest: ${id}`);
  }
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  if (!html.includes('./assets/')) throw new Error('Immutable release package requires ASSET_BASE=./');
  const scripts = await Promise.all(declared.filter(path => path.endsWith('.js')).map(path => readFile(resolve(root, path), 'utf8')));
  for (const token of ['__RUNNER_TEST__', '__PRODUCT_LIFECYCLE__', '__PRODUCT_RESOURCES__', 'installCaptureHooks', 'debugRelease', '__BETA_MONITOR__']) {
    if (scripts.some(script => script.includes(token))) throw new Error(`Development hook in release: ${token}`);
  }
  return { release, fileCount: declared.length, bytes: Object.values(manifest.files).reduce((sum, entry) => sum + entry.bytes, 0), glbs: Object.keys(assets.assets).length, manifestSha256: hash(await readFile(resolve(root, 'release-manifest.json'))) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { console.log(JSON.stringify(await verifyRelease(process.argv[2]), null, 2)); }
  catch (error) { console.error(`[release:verify] ${error instanceof Error ? error.message : 'Failed'}`); process.exitCode = 1; }
}
