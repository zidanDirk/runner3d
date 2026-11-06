import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { platform, release } from 'node:os';
import type { Page } from '@playwright/test';
import { waitForCharacterPreview } from './preview-readiness';
import { visualHostFacts } from '../../scripts/visual/platform.mjs';
import { visualSourceFacts } from '../../scripts/visual/candidate.mjs';

function systemPingFangFiles(): { path: string; sha256: string }[] {
  const root = '/System/Library/AssetsV2';
  if (platform() !== 'darwin' || !existsSync(root)) return [];
  const result: { path: string; sha256: string }[] = [];
  const walk = (directory: string, depth: number): void => {
    if (depth > 4) return;
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path, depth + 1);
      else if (item.isFile() && item.name === 'PingFang.ttc') result.push({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
    }
  };
  for (const item of readdirSync(root, { withFileTypes: true })) if (item.isDirectory() && /^com_apple_MobileAsset_Font\d+$/.test(item.name)) walk(join(root, item.name), 0);
  return result;
}

/** Read actual page/CDP/WebGL facts. No selector, approval, or screenshot mutation. */
export async function collectVisualProvenance(page: Page, browserVersion: string) {
  await page.goto('/');
  await waitForCharacterPreview(page);
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
    if (nodeId <= 0) throw new Error('Visual provenance requires the rendered heading');
    const fonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    if (fonts.fonts.length === 0) throw new Error('Visual provenance requires actual rendered fonts');
    const environment = await page.evaluate(() => {
      const gl = document.querySelector('canvas')?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { devicePixelRatio: window.devicePixelRatio, vendor: gl && debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : null,
        language: navigator.language, languages: navigator.languages, userAgent: navigator.userAgent,
        cssFontFamily: getComputedStyle(document.querySelector('h1') ?? document.body).fontFamily,
        renderer: gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null };
    });
    return { source: visualSourceFacts(), runner: visualHostFacts(), host: { os: platform(), release: release(), browser: browserVersion },
      ...environment, actualFonts: fonts.fonts, systemPingFangFiles: systemPingFangFiles() };
  } finally { await cdp.detach(); }
}
