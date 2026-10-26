import { describe, expect, it } from 'vitest';
import { IMMUTABLE, releaseFilePolicy, sameCacheControl } from '../../scripts/release/cache-policy.mjs';

describe('immutable candidate cache policy', () => {
  it.each([
    ['index.html', 'text/html'], ['release.json', 'application/json'], ['release-manifest.json', 'application/json'], ['nested/a.HTML', 'text/html'],
  ])('sets no-store and the explicit MIME for %s', (path, mimeType) => {
    expect(releaseFilePolicy(path)).toEqual({ cacheControl: 'no-store', mimeType });
  });
  it.each([
    ['assets/app.js', 'application/javascript'], ['assets/app.css', 'text/css'], ['models/generated/roadblock.glb', 'model/gltf-binary'],
    ['favicon.svg', 'image/svg+xml'], ['icon.ico', 'image/x-icon'], ['a.png', 'image/png'], ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'], ['a.webp', 'image/webp'], ['a.avif', 'image/avif'], ['a.gif', 'image/gif'],
    ['a.woff', 'font/woff'], ['a.woff2', 'font/woff2'], ['a.ttf', 'font/ttf'], ['a.otf', 'font/otf'],
    ['a.mp3', 'audio/mpeg'], ['a.ogg', 'audio/ogg'], ['a.wav', 'audio/wav'], ['a.m4a', 'audio/mp4'], ['a.wasm', 'application/wasm'],
  ])('explicitly assigns immutable caching and MIME for %s', (path, mimeType) => {
    expect(releaseFilePolicy(path)).toEqual({ mimeType, cacheControl: 'public, max-age=31536000, immutable' });
  });
  it.each([
    ['robots.txt', 'text/plain'], ['sitemap.xml', 'application/xml'], ['manifest.webmanifest', 'application/manifest+json'],
  ])('does not long-cache metadata and sets MIME for %s', (path, mimeType) => {
    expect(releaseFilePolicy(path)).toEqual({ cacheControl: 'no-store', mimeType });
  });
  it.each(['unknown.bin', 'extensionless', 'a.map', '../index.html', '/index.html', 'a//b.js', 'a/./b.js', 'a.js?x=1'])('rejects unreviewed/unsafe path %s before uploading anything', path => {
    expect(() => releaseFilePolicy(path)).toThrow();
  });
  it('normalizes only syntax, never accepts missing or conflicting directives', () => {
    expect(sameCacheControl('immutable, public,max-age=31536000', IMMUTABLE)).toBe(true);
    for (const bad of [undefined, '', 'public,max-age=31536000', `${IMMUTABLE},no-store`, `${IMMUTABLE},private`, `${IMMUTABLE},immutable`, 'public,max-age=31536001,immutable']) expect(sameCacheControl(bad, IMMUTABLE)).toBe(false);
  });
  it.each([
    'PUBLIC, MAX-AGE=31536000, IMMUTABLE',
    ' \timmutable \t, public , max-age=31536000\t ',
    'max-age=31536000,immutable,public',
  ])('compares case-insensitively, trimming each comma-separated directive and ignoring order: %s', actual => {
    expect(sameCacheControl(actual, IMMUTABLE)).toBe(true);
  });
  it('applies the same case/edge-space/order rules to both arguments', () => {
    expect(sameCacheControl(IMMUTABLE, ' IMMUTABLE, MAX-AGE=31536000 , PUBLIC ')).toBe(true);
    expect(sameCacheControl(' \tNO-STORE ', 'no-store')).toBe(true);
  });
  it.each([
    'public, max-age=31536000', // Missing immutable is not equivalent.
    `${IMMUTABLE}, no-cache`, `${IMMUTABLE}, no-store`, `${IMMUTABLE}, private`,
    `${IMMUTABLE}, max-age=0`, `${IMMUTABLE}, max-age=31536000`, `${IMMUTABLE}, immutable`,
    `${IMMUTABLE}, must-revalidate`, `${IMMUTABLE},`,
    'public, max-age =31536000, immutable', 'public, max-age= 31536000, immutable',
    'public, max-age=, immutable',
  ])('rejects missing, conflicting, duplicate, extra or internally different directive text: %s', actual => {
    // The comparator is exact after lowercasing + comma splitting + edge trim +
    // sorting. It deliberately does not parse values or normalize around "=".
    expect(sameCacheControl(actual, IMMUTABLE)).toBe(false);
  });
  it.each(['no-store, no-cache', 'no-store, public', 'no-store, no-store', 'no-store,'])('does not accept extra directives for no-store: %s', actual => {
    expect(sameCacheControl(actual, 'no-store')).toBe(false);
  });
});
