import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Explicit operator invocation only. Compare remote bytes with the reviewed local manifest. */
export async function verifyRemoteRelease(address, expectedId, { fetcher = fetch, manifestBytes } = {}) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) throw new Error('Provide a public HTTPS release directory URL without credentials or query parameters');
  const get = async path => {
    const response = await fetcher(new URL(path, url), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const remoteBytes = await get('release-manifest.json');
  const localBytes = manifestBytes ?? await readFile('dist/release-manifest.json');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  if (digest(remoteBytes) !== digest(localBytes)) throw new Error('Remote manifest differs from the reviewed artifact');
  const manifest = JSON.parse(new TextDecoder().decode(remoteBytes));
  if (manifest.schemaVersion !== 1 || manifest.release.buildId !== expectedId || !['preview', 'production'].includes(manifest.release.environment)) throw new Error('Remote release identity mismatch');
  for (const [path, entry] of Object.entries(manifest.files)) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '..')) throw new Error('Unsafe remote file map');
    const bytes = await get(path);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error(`Remote integrity mismatch: ${path}`);
  }
  return { verifiedAt: new Date().toISOString(), buildId: expectedId, files: Object.keys(manifest.files).length, https: true, manifestSha256: digest(remoteBytes), scope: 'HTTPS transport and exact reviewed static bytes; browser smoke is separate' };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { console.log(JSON.stringify(await verifyRemoteRelease(process.argv[2] ?? '', process.argv[3]), null, 2)); }
  catch (error) { console.error(`[release:remote-smoke] ${error instanceof Error ? error.message : 'Failed'}`); process.exitCode = 1; }
}
