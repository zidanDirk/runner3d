import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createReleaseInfo, validateBase } from './src/release/config';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appPackage: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
  if (typeof appPackage !== 'object' || appPackage === null || !('version' in appPackage) || typeof appPackage.version !== 'string') throw new Error('package.json version is missing');
  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Source archives have no Git metadata. */ }
  const release = createReleaseInfo({ version: appPackage.version, environment: env.RELEASE_ENV ?? (command === 'serve' ? 'development' : 'production'), commit: env.BUILD_COMMIT ?? commit,
    buildTime: env.BUILD_TIME ?? new Date().toISOString(), ...(env.BUILD_ID ? { buildId: env.BUILD_ID } : {}) });
  let outDir = resolve('dist');
  const releaseMetadata: Plugin = {
    name: 'runner3d-release-metadata',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify(release, null, 2) + '\n' }); },
    closeBundle() {
      if (command !== 'build') return;
      const files: Record<string, { bytes: number; sha256: string }> = {};
      const visit = (directory: string): void => {
        for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const path = resolve(directory, item.name);
          if (item.isDirectory()) visit(path);
          else if (item.isFile() && item.name !== 'release-manifest.json') {
            const bytes = readFileSync(path);
            files[relative(outDir, path).split('\\').join('/')] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
          }
        }
      };
      visit(outDir);
      writeFileSync(resolve(outDir, 'release-manifest.json'), JSON.stringify({ schemaVersion: 1, release, files }, null, 2) + '\n');
    },
  };
  return {
  plugins: [react(), releaseMetadata],
  define: { __APP_RELEASE__: JSON.stringify(release) },
  base: validateBase(env.ASSET_BASE ?? './'),
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
  build: { rollupOptions: { output: { onlyExplicitManualChunks: true, manualChunks(id) {
    if (id.includes('/node_modules/three/')) return 'three';
    if (id.includes('/node_modules/@react-three/') || id.includes('/node_modules/three-stdlib/')) return 'fiber';
    if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
  } } } },
  };
});
