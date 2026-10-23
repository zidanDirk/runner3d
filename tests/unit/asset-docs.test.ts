import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_TYPES, GENERATOR_VERSION } from '../../scripts/assets/config.mjs';
import manifest from '../../src/assets/generated/manifest.json';

const document = readFileSync(new URL('../../docs/asset-pipeline.md', import.meta.url), 'utf8');
// Only the opening section describes the current factory; later sections retain history.
const summary = document.split(/^# /m)[1] ?? '';

 describe('asset pipeline current summary', () => {
  it('matches the real registered generator type count', () => {
    const chineseCounts = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const documentedCount = summary.match(/当前为([^、\s]+)类生成器/)?.[1];
    const expectedCount = chineseCounts[ASSET_TYPES.length];
    expect(expectedCount).toBeDefined();
    expect(documentedCount).toBe(expectedCount);
  });

  it('matches the real Manifest resource count in both summary claims', () => {
    const count = Object.keys(manifest.assets).length;
    expect(summary.match(/类生成器、(\d+)个资源/)?.[1]).toBe(String(count));
    expect(summary.match(/同时验证(\d+)份资源/)?.[1]).toBe(String(count));
  });

  it('matches the real generator version', () => {
    expect(summary.match(/Node\/Python generator([^、\s]+)、/)?.[1]).toBe(GENERATOR_VERSION);
  });
});
