import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyRemoteRelease } from '../../scripts/release/remote-smoke.mjs';

const base = 'https://example.invalid/runner/releases/test-16/';
const commit = 'a'.repeat(40);
const release = { version: '0.14.0-beta', buildId: 'test-16', commit, buildTime: '2026-10-22T01:02:03.000Z', environment: 'preview' };
const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
const fileHeaders = (path: string): Record<string, string> => ({
  'content-type': path.endsWith('.html') ? 'text/html' : path.endsWith('.json') ? 'application/json' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'model/gltf-binary',
  'cache-control': /\.(html|json)$/.test(path) ? 'no-store' : 'public,max-age=31536000,immutable',
});
function fixture() {
  // Synthetic HTTP contract only; actual GLBs/Three/browser loading are separate checks.
  const contents: Record<string, string> = { 'index.html': '<html>Runner3D</html>', 'assets/app.js': 'export const game = 1;', 'assets/app.css': 'body { margin: 0; }', 'models/generated/roadblock.glb': 'synthetic-glb-bytes', 'release.json': JSON.stringify(release) };
  const files = Object.fromEntries(Object.entries(contents).map(([path, content]) => [path, { bytes: Buffer.byteLength(content), sha256: hash(content) }]));
  const manifest = { schemaVersion: 1, release: { ...release }, files };
  const manifestBytes = encode(JSON.stringify(manifest));
  const requested: URL[] = [];
  const fetcher = async (url: URL, options: RequestInit): Promise<Response> => {
    requested.push(url); expect(options.cache).toBe('no-store'); expect(options.signal).toBeInstanceOf(AbortSignal);
    if (url.protocol === 'http:') { expect(options.redirect).toBe('manual'); return new Response(null, { status: 301, headers: { location: base } }); }
    expect(options.redirect).toBe('error');
    const path = url.pathname.slice(new URL(base).pathname.length);
    if (path.includes('__runner3d_missing_')) return new Response('not found', { status: 404 });
    return new Response(path === 'release-manifest.json' ? text(manifestBytes) : contents[path], { headers: fileHeaders(path) });
  };
  return { manifest, manifestBytes, requested, fetcher, contents };
}

it('remote smoke requests only the reviewed HTTPS directory and compares real response bytes', async () => {
  const f = fixture();
  const report = await verifyRemoteRelease(base, 'test-16', { ...f, expectedCommit: commit });
  expect(report).toMatchObject({ files: 5, https: true, buildId: 'test-16', commit, missingGLB: 404, httpRedirect: true, transport: 'injected-test-transport' });
  expect(report.headers).toHaveLength(7);
  expect(f.requested.filter(u => u.protocol === 'https:').every(u => u.origin === new URL(base).origin && u.pathname.startsWith(new URL(base).pathname))).toBe(true);
  expect(f.requested.filter(u => u.pathname.endsWith('release-manifest.json'))).toHaveLength(2);
  expect(f.requested.filter(u => u.protocol === 'http:').map(u => u.href)).toEqual([base.replace('https:', 'http:')]);
});

it('does not certify a stale manifest, failed file request or mixed cached resource', async () => {
  const f = fixture();
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async () => new Response('{}', { headers: fileHeaders('release-manifest.json') }) })).rejects.toThrow('differs');
  for (const status of [404, 503]) await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async (url, options) => url.pathname.endsWith('index.html') ? new Response('failure', { status }) : f.fetcher(url, options) })).rejects.toThrow(`HTTP ${status}`);
  const wrong = f.contents['assets/app.js']?.replace('1', '2') ?? '';
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async (url, options) => url.pathname.endsWith('app.js') ? new Response(wrong, { headers: fileHeaders('app.js') }) : f.fetcher(url, options) })).rejects.toThrow('integrity mismatch');
});

it('rejects transport failure and unsafe manifest URLs without leaving the release directory', async () => {
  const f = fixture();
  for (const path of ['../outside.html', 'assets/./alias.js', '/outside.js', 'https://other.invalid/a.js']) {
    const bytes = encode(JSON.stringify({ ...f.manifest, files: { ...f.manifest.files, [path]: { bytes: 1, sha256: hash('x') } } }));
    await expect(verifyRemoteRelease(base, 'test-16', { ...f, manifestBytes: bytes })).rejects.toThrow('Unsafe');
  }
  expect(f.requested).toHaveLength(0);
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
  for (const address of ['http://example.invalid/', 'https://user:pass@example.invalid/', base + '?token=private', base.slice(0, -1)]) await expect(verifyRemoteRelease(address, 'test-16', f)).rejects.toThrow('HTTPS');
});

it('binds the reviewed source commit and build before issuing any request', async () => {
  const f = fixture();
  await expect(verifyRemoteRelease(base, 'other-build', f)).rejects.toThrow('identity');
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, expectedCommit: 'b'.repeat(40) })).rejects.toThrow('identity');
  expect(f.requested).toHaveLength(0);
});

it.each(['assets/app.js', 'assets/app.css', 'models/generated/roadblock.glb', 'release.json'])('rejects HTML returned as %s even when all bytes match', async path => {
  const f = fixture();
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async (url, options) => {
    const response = await f.fetcher(url, options); if (url.pathname.endsWith(path)) response.headers.set('content-type', 'text/html'); return response;
  } })).rejects.toThrow('Incorrect MIME');
});

it.each(['index.html', 'release.json', 'assets/app.js', 'assets/app.css', 'models/generated/roadblock.glb'])('blocks unsafe or missing cache headers on %s', async path => {
  const f = fixture();
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async (url, options) => {
    const response = await f.fetcher(url, options); if (url.pathname.endsWith(path)) response.headers.set('cache-control', 'public,max-age=31536000'); return response;
  } })).rejects.toThrow(/cache/);
});

it('rejects a 200 HTML fallback or upstream outage for a missing GLB', async () => {
  for (const status of [200, 503]) {
    const f = fixture();
    await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async (url, options) => url.pathname.includes('__runner3d_missing_') ? new Response('<html>app</html>', { status }) : f.fetcher(url, options) })).rejects.toThrow('real 404');
  }
});

it.each([null, 'https://other.invalid/', base.replace('https:', 'http:')])('rejects HTTP without the exact HTTPS redirect: %s', async location => {
  const f = fixture();
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async (url, options) => url.protocol === 'http:' ? new Response(null, { status: location ? 302 : 200, headers: location ? { location } : {} }) : f.fetcher(url, options) })).rejects.toThrow('HTTP must redirect');
});

it('rejects metadata changing between the first and final request', async () => {
  const f = fixture(); let reads = 0;
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async (url, options) => {
    if (url.pathname.endsWith('release-manifest.json') && ++reads > 1) return new Response('{}', { headers: fileHeaders('release-manifest.json') });
    return f.fetcher(url, options);
  } })).rejects.toThrow('changed during');
});

it('bounds declared and streamed responses and invalid reviewed manifests', async () => {
  const f = fixture();
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async () => new Response('{}', { headers: { ...fileHeaders('release-manifest.json'), 'content-length': String(300000) } }) })).rejects.toThrow('transfer budget');
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async () => new Response('x'.repeat(300000), { headers: fileHeaders('release-manifest.json') }) })).rejects.toThrow('transfer budget');
  for (const manifest of [{ ...f.manifest, unknown: true }, { ...f.manifest, release: { ...release, commit: 1234567 } }, { ...f.manifest, files: { ...f.manifest.files, 'assets/app.js': { bytes: 0, sha256: hash('') } } }]) await expect(verifyRemoteRelease(base, 'test-16', { ...f, manifestBytes: encode(JSON.stringify(manifest)) })).rejects.toThrow(/Invalid|Unsafe/);
});

it('refuses a globally disabled TLS certificate check', async () => {
  vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
  try { await expect(verifyRemoteRelease(base, 'test-16', fixture())).rejects.toThrow('TLS certificate'); }
  finally { vi.unstubAllEnvs(); }
});
it('bounds decoded bytes while allowing gzip overhead on tiny source files', async () => {
  const f = fixture();
  await expect(verifyRemoteRelease(base, 'test-16', { ...f, fetcher: async (url, options) => {
    const response = await f.fetcher(url, options);
    if (url.pathname.endsWith('app.js')) { response.headers.set('content-encoding', 'gzip'); response.headers.set('content-length', '40'); }
    return response;
  } })).resolves.toMatchObject({ files: 5 });
});
