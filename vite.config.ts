import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
  build: { rollupOptions: { output: { onlyExplicitManualChunks: true, manualChunks(id) {
    if (id.includes('/node_modules/three/')) return 'three';
    if (id.includes('/node_modules/@react-three/') || id.includes('/node_modules/three-stdlib/')) return 'fiber';
    if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
  } } } },
});
