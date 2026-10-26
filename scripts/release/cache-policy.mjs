import { extname } from 'node:path';

export const NO_STORE = 'no-store';
export const IMMUTABLE = 'public, max-age=31536000, immutable';
const types = {
  '.html': ['text/html', NO_STORE], '.json': ['application/json', NO_STORE],
  '.js': ['application/javascript', IMMUTABLE], '.css': ['text/css', IMMUTABLE], '.glb': ['model/gltf-binary', IMMUTABLE],
  '.svg': ['image/svg+xml', IMMUTABLE], '.png': ['image/png', IMMUTABLE], '.jpg': ['image/jpeg', IMMUTABLE],
  '.jpeg': ['image/jpeg', IMMUTABLE], '.webp': ['image/webp', IMMUTABLE], '.avif': ['image/avif', IMMUTABLE],
  '.gif': ['image/gif', IMMUTABLE], '.ico': ['image/x-icon', IMMUTABLE],
  '.woff2': ['font/woff2', IMMUTABLE], '.woff': ['font/woff', IMMUTABLE], '.ttf': ['font/ttf', IMMUTABLE], '.otf': ['font/otf', IMMUTABLE],
  '.mp3': ['audio/mpeg', IMMUTABLE], '.ogg': ['audio/ogg', IMMUTABLE], '.wav': ['audio/wav', IMMUTABLE],
  '.m4a': ['audio/mp4', IMMUTABLE], '.wasm': ['application/wasm', IMMUTABLE],
  '.txt': ['text/plain', NO_STORE], '.xml': ['application/xml', NO_STORE], '.webmanifest': ['application/manifest+json', NO_STORE],
};

/** Only for immutable releases/<BuildID>/ objects, never the stable entry. */
export function releaseFilePolicy(path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(path) || !path.split('/').every(p => p && p !== '.' && p !== '..')) throw new Error('Invalid release file path');
  const policy = types[extname(path).toLowerCase()];
  if (!policy) throw new Error(`No reviewed cache/MIME policy for: ${path}`);
  return Object.freeze({ mimeType: policy[0], cacheControl: policy[1] });
}

export function sameCacheControl(actual, expected) {
  if (typeof actual !== 'string') return false;
  const parts = value => value.toLowerCase().split(',').map(s => s.trim()).sort();
  return JSON.stringify(parts(actual)) === JSON.stringify(parts(expected));
}
