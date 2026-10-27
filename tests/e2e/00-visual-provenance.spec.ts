import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { platform, release } from 'node:os';
import { waitForCharacterPreview } from './preview-readiness';
import { currentVisualPlatform, REVIEWED_BROWSER_VERSION, visualHostFacts } from '../../scripts/visual/platform.mjs';
import { currentCandidateDiagnostic, visualSourceFacts } from '../../scripts/visual/candidate.mjs';

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

test('records actual CJK font and WebGL provenance without altering screenshots', async ({ page, browser }, testInfo) => {
  await page.goto('/');
  await waitForCharacterPreview(page);
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
    expect(nodeId).toBeGreaterThan(0);
    const fonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(fonts.fonts.length).toBeGreaterThan(0);
    const environment = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { devicePixelRatio: window.devicePixelRatio, vendor: gl && debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : null, language: navigator.language, languages: navigator.languages, userAgent: navigator.userAgent,
        cssFontFamily: getComputedStyle(document.querySelector('h1') ?? document.body).fontFamily,
        renderer: gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null };
    });
    const comparison = testInfo.config.metadata.visualCandidate ? currentCandidateDiagnostic() : currentVisualPlatform();
    const report = { comparison, source: visualSourceFacts(), runner: visualHostFacts(), host: { os: platform(), release: release(), browser: browser.version() }, ...environment, actualFonts: fonts.fonts, systemPingFangFiles: systemPingFangFiles() };
    writeFileSync(testInfo.outputPath('visual-provenance.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`[visual-provenance] ${JSON.stringify(report)}`);
    if (comparison.id === 'github-macos-26') expect(browser.version()).toBe(REVIEWED_BROWSER_VERSION);
  } finally { await cdp.detach(); }
});
