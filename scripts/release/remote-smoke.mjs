import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MAX_FILE = 8 * 1024 * 1024;
const MAX_MANIFEST = 256 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = path => /^[a-zA-Z0-9_./-]+$/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function reviewedManifest(bytes, expectedId, expectedCommit) {
  if (bytes.length > MAX_MANIFEST) throw new Error('Reviewed manifest exceeds size budget');
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!exact(value, ['schemaVersion', 'release', 'files']) || value.schemaVersion !== 1 || !exact(value.release, ['version', 'buildId', 'commit', 'buildTime', 'environment'])) throw new Error('Invalid reviewed manifest schema');
  const r = value.release;
  if (Object.values(r).some(v => typeof v !== 'string') || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(r.version) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(r.buildId) || !/^[a-f0-9]{7,40}$/.test(r.commit) || !Number.isFinite(Date.parse(r.buildTime)) || new Date(r.buildTime).toISOString() !== r.buildTime || !['preview', 'production'].includes(r.environment)) throw new Error('Invalid reviewed release identity');
  if (r.buildId !== expectedId || (expectedCommit !== undefined && (!/^[a-f0-9]{40}$/.test(expectedCommit) || r.commit !== expectedCommit))) throw new Error('Reviewed source commit/build identity mismatch');
  if (!object(value.files) || !Object.hasOwn(value.files, 'index.html') || !Object.hasOwn(value.files, 'release.json') || Object.keys(value.files).length > 256) throw new Error('Invalid reviewed file map');
  let total = 0;
  for (const [path, entry] of Object.entries(value.files)) {
    if (!safePath(path) || path === 'release-manifest.json' || !exact(entry, ['bytes', 'sha256']) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_FILE || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Unsafe remote file map');
    total += entry.bytes;
  }
  if (total > 64 * 1024 * 1024) throw new Error('Reviewed release exceeds transfer budget');
  return value;
}
function hostingHeaders(response, path) {
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const types = path.endsWith('.html') ? ['text/html'] : path.endsWith('.json') ? ['application/json'] : path.endsWith('.js') ? ['application/javascript', 'text/javascript'] : path.endsWith('.css') ? ['text/css'] : path.endsWith('.glb') ? ['model/gltf-binary', 'application/octet-stream'] : null;
  if (types && !types.includes(mime)) throw new Error(`Incorrect MIME: ${path}`);
  const cache = (response.headers.get('cache-control') ?? '').toLowerCase();
  const directives = cache.split(',').map(part => part.trim());
  if (/\.(?:html|json)$/.test(path)) {
    if (!directives.some(d => /^(?:no-store|no-cache(?:=.*)?|(?:s-)?max-age=0)$/.test(d)) || (!directives.includes('no-store') && !directives.some(d => d.startsWith('no-cache')) && directives.some(d => /^(?:s-)?max-age=[1-9]\d*$/.test(d)))) throw new Error(`Metadata cache must revalidate: ${path}`);
  } else if (/\.(?:js|css|glb)$/.test(path)) {
    const age = directives.find(d => d.startsWith('max-age='))?.slice(8);
    if (!directives.includes('public') || !directives.includes('immutable') || !age || !/^\d+$/.test(age) || Number(age) < 31536000 || directives.some(d => /^(?:no-cache|no-store|private)(?:=|$)/.test(d))) throw new Error(`Immutable resource cache missing: ${path}`);
  }
  return { path, contentType: mime, cacheControl: cache, age: response.headers.get('age'), etag: response.headers.get('etag') };
}
async function limitedBytes(response, limit) {
  const declared = response.headers.get('content-length');
  const encoding = response.headers.get('content-encoding');
  // fetch exposes decoded bodies; compressed transfer length can exceed a very small source file.
  if ((!encoding || encoding === 'identity') && declared && /^\d+$/.test(declared) && Number(declared) > limit) throw new Error('Response exceeds transfer budget');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) { await reader.cancel(); throw new Error('Response exceeds transfer budget'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/** Explicit operator invocation only. Compare remote bytes with the reviewed local manifest. */
export async function verifyRemoteRelease(address, expectedId, { fetcher = fetch, manifestBytes, expectedCommit } = {}) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) throw new Error('Provide a public HTTPS release directory URL without credentials or query parameters');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS certificate verification must remain enabled');
  const localBytes = manifestBytes ?? await readFile('dist/release-manifest.json');
  const manifest = reviewedManifest(localBytes, expectedId, expectedCommit);
  const deadline = AbortSignal.timeout(120000), headers = [];
  const get = async path => {
    const target = new URL(path, url);
    if (target.origin !== url.origin || !target.pathname.startsWith(url.pathname)) throw new Error('Resource escaped reviewed directory');
    const response = await fetcher(target, { redirect: 'error', cache: 'no-store', signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
    headers.push(hostingHeaders(response, path));
    return limitedBytes(response, path === 'release-manifest.json' ? MAX_MANIFEST : manifest.files[path]?.bytes ?? MAX_FILE);
  };
  const remoteBytes = await get('release-manifest.json');
  if (digest(remoteBytes) !== digest(localBytes)) throw new Error('Remote manifest differs from the reviewed artifact');
  for (const [path, entry] of Object.entries(manifest.files)) {
    const bytes = await get(path);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error(`Remote integrity mismatch: ${path}`);
    if (path === 'release.json') {
      const identity = JSON.parse(new TextDecoder().decode(bytes));
      if (!exact(identity, Object.keys(manifest.release)) || Object.keys(manifest.release).some(key => identity[key] !== manifest.release[key])) throw new Error('Remote release.json identity mismatch');
    }
  }
  const missing = await fetcher(new URL(`models/generated/__runner3d_missing_${expectedId}.glb`, url), { redirect: 'error', cache: 'no-store', signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]) });
  if (missing.status !== 404) throw new Error('Missing GLB must return a real 404, never the HTML application');
  const http = new URL(url); http.protocol = 'http:';
  const redirect = await fetcher(http, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]) });
  const location = redirect.headers.get('location');
  if (![301, 302, 307, 308].includes(redirect.status) || !location || new URL(location, http).href !== url.href) throw new Error('HTTP must redirect to the exact HTTPS release directory');
  if (digest(await get('release-manifest.json')) !== digest(localBytes)) throw new Error('Manifest changed during verification');
  return { verifiedAt: new Date().toISOString(), buildId: expectedId, commit: manifest.release.commit, files: Object.keys(manifest.files).length, https: true, transport: fetcher === fetch ? 'native-fetch-tls' : 'injected-test-transport', httpRedirect: true, missingGLB: 404, headers, manifestSha256: digest(remoteBytes), scope: 'Observed TLS, HTTP redirect, exact reviewed bytes, MIME, cache headers and missing GLB; browser/cache reuse, global CDN propagation and real-device acceptance are separate' };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { console.log(JSON.stringify(await verifyRemoteRelease(process.argv[2] ?? '', process.argv[3], { expectedCommit: process.argv[4] }), null, 2)); }
  catch (error) { console.error(`[release:remote-smoke] ${error instanceof Error ? error.message : 'Failed'}`); process.exitCode = 1; }
}
