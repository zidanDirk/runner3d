import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyRemoteRelease } from '../../scripts/release/remote-smoke.mjs';

const base = 'https://example.invalid/runner/releases/test-14/';
const content = '<html>Runner3D</html>';
function manifest(path = 'index.html'): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, release: { buildId: 'test-14', environment: 'preview' }, files: { [path]: { bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') } } }));
}
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

it('remote smoke requests only the reviewed HTTPS directory and compares real response bytes', async () => {
  const requested: string[] = [], manifestBytes = manifest();
  const report = await verifyRemoteRelease(base, 'test-14', { manifestBytes, fetcher: async (url, options) => {
    requested.push(url.href); expect(options.redirect).toBe('error'); expect(options.cache).toBe('no-store');
    return new Response(url.pathname.endsWith('release-manifest.json') ? text(manifestBytes) : content);
  } });
  expect(report).toMatchObject({ files: 1, https: true, buildId: 'test-14' });
  expect(requested).toEqual([base + 'release-manifest.json', base + 'index.html']);
});

it('does not certify a stale manifest, failed file request or mixed cached resource', async () => {
  const manifestBytes = manifest();
  await expect(verifyRemoteRelease(base, 'test-14', { manifestBytes, fetcher: async () => new Response('{}') })).rejects.toThrow('differs');
  for (const status of [404, 503]) await expect(verifyRemoteRelease(base, 'test-14', { manifestBytes, fetcher: async url => new Response(url.pathname.endsWith('.json') ? text(manifestBytes) : 'failure', { status: url.pathname.endsWith('.json') ? 200 : status }) })).rejects.toThrow(`HTTP ${status}`);
  await expect(verifyRemoteRelease(base, 'test-14', { manifestBytes, fetcher: async url => new Response(url.pathname.endsWith('.json') ? text(manifestBytes) : 'old JS or GLB') })).rejects.toThrow('integrity mismatch');
});

it('rejects transport failure and unsafe manifest URLs without leaving the release directory', async () => {
  const bytes = manifest('../outside.html'); let calls = 0;
  await expect(verifyRemoteRelease(base, 'test-14', { manifestBytes: bytes, fetcher: async () => { calls++; return new Response(text(bytes)); } })).rejects.toThrow('Unsafe');
  expect(calls).toBe(1);
  await expect(verifyRemoteRelease(base, 'test-14', { fetcher: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
  for (const address of ['http://example.invalid/', 'https://user:pass@example.invalid/', base + '?token=private', base.slice(0, -1)]) await expect(verifyRemoteRelease(address, 'test-14')).rejects.toThrow('HTTPS');
});
