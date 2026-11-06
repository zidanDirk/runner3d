import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// Deterministic diagnostic fixtures only. No game snapshots, game state or
// screenshot update mode is involved in constructing these reference pixels.
const root = 'artifacts/visual-actual/fixture-references';
const mode = process.env.RUNNER3D_ACTUAL_FIXTURE_MODE;
if (mode !== 'native' && mode !== 'instrumented') throw new Error('Explicit native or instrumented fixture mode is required');
const output = `artifacts/visual-actual/fixture-${mode}`;
const observed: { name: string; verdict: 'PASS' | 'EXPECTED_FAILURE'; actualSha256: string | null; actualSource: string; errorKind?: string }[] = [];
type Pixel = readonly [number, number, number, number];
const blue: Pixel = [17, 34, 51, 255];

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(width: number, height: number, color: (x: number, y: number) => Pixel): Buffer {
  const chunk = (name: string, bytes: Buffer): Buffer => {
    const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
    return Buffer.concat([length, type, bytes, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = color(x, y), offset = y * (width * 4 + 1) + 1 + x * 4;
    for (let channel = 0; channel < 4; channel++) rows[offset + channel] = pixel[channel] ?? 0;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function solid(page: Page, extra = ''): Promise<void> {
  await page.setContent(`<style>html,body{margin:0;background:white}#target{position:relative;width:24px;height:24px;background:rgb(17,34,51)}${extra}</style><div id="target"></div>`);
}

function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

function verdict(info: TestInfo, reference: string, status: 'PASS' | 'FAIL', actualBufferSHA: string | null): void {
  mkdirSync(join(output, 'verdicts'), { recursive: true });
  const record = { caseId: info.title, status, expectedStatus: status, referencePath: join(root, reference),
    referenceSha256: sha(readFileSync(join(root, reference))), actualBufferSHA,
    eligibleForRelease: false, scope: 'mechanism-fixture-only' };
  writeFileSync(join(output, 'verdicts', `${sha(Buffer.from(info.title))}.json`), JSON.stringify(record, null, 2) + '\n');
}

function publicFailureActual(info: TestInfo): string | null {
  const attachment = info.attachments.find(item => item.name.endsWith('-actual') && item.contentType === 'image/png');
  return attachment?.path && existsSync(attachment.path) ? sha(readFileSync(attachment.path)) : null;
}

async function expectedFailure(info: TestInfo, reference: string, kind: string, action: () => Promise<unknown>): Promise<void> {
  let failed = false;
  try { await action(); } catch (error) { failed = error instanceof Error; }
  expect(failed).toBe(true);
  verdict(info, reference, 'FAIL', publicFailureActual(info));
  observed.push({ name: info.title, verdict: 'EXPECTED_FAILURE', actualSha256: publicFailureActual(info),
    actualSource: 'public-failure-attachment-or-explicitly-unavailable', errorKind: kind });
}

test.beforeAll(() => {
  mkdirSync(root, { recursive: true });
  for (const name of ['fixture-solid', 'fixture-animations', 'fixture-css-scale', 'fixture-buffer']) writeFileSync(join(root, `${name}.png`), png(24, 24, () => blue));
  writeFileSync(join(root, 'fixture-masked.png'), png(24, 24, x => x < 12 ? [0, 255, 0, 255] : blue));
  writeFileSync(join(root, 'fixture-wrong.png'), png(24, 24, () => [240, 220, 200, 255]));
  writeFileSync(join(root, 'fixture-dimensions.png'), png(20, 24, () => blue));
  writeFileSync(join(root, 'fixture-style.css'), '#target{border:0!important}');
});

test.afterAll(() => {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'fixture-results.json'), JSON.stringify({ scope: 'mechanism-fixture-only',
    mode, eligibleForRelease: false, observed }, null, 2) + '\n');
});

test('fixture first-iteration match retains native verdict', async ({ page }, info) => {
  await solid(page);
  await expect(page.locator('#target')).toHaveScreenshot('fixture-solid.png', { animations: 'disabled', maxDiffPixels: 0, threshold: 0 });
  verdict(info, 'fixture-solid.png', 'PASS', null);
  observed.push({ name: info.title, verdict: 'PASS', actualSha256: null, actualSource: 'native-success-does-not-publicly-return-buffer' });
});

test('fixture native animation disabling remains unchanged', async ({ page }, info) => {
  await solid(page, '@keyframes toBlue{from{background:rgb(240,220,200)}to{background:rgb(17,34,51)}}#target{animation:toBlue 4s linear forwards}');
  await expect(page.locator('#target')).toHaveScreenshot('fixture-animations.png', { animations: 'disabled', maxDiffPixels: 0, threshold: 0 });
  verdict(info, 'fixture-animations.png', 'PASS', null);
  observed.push({ name: info.title, verdict: 'PASS', actualSha256: null, actualSource: 'native-success-does-not-publicly-return-buffer' });
});

test('fixture masks styles and CSS screenshot scale are retained', async ({ page }, info) => {
  await solid(page, '#target{border:4px solid red}');
  await page.locator('#target').evaluate(element => { element.innerHTML = '<div id="mask" style="width:12px;height:24px;background:red"></div>'; });
  await expect(page.locator('#target')).toHaveScreenshot('fixture-masked.png', {
    animations: 'disabled', mask: [page.locator('#mask')], maskColor: '#00ff00', caret: 'hide',
    stylePath: join(root, 'fixture-style.css'), scale: 'css', maxDiffPixelRatio: 0, threshold: 0,
  });
  verdict(info, 'fixture-masked.png', 'PASS', null);
  observed.push({ name: info.title, verdict: 'PASS', actualSha256: null, actualSource: 'native-success-does-not-publicly-return-buffer' });
});

test('fixture CSS scale remains CSS pixels at DPR two', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 96, height: 96 }, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage(); await solid(page);
    await expect(page.locator('#target')).toHaveScreenshot('fixture-css-scale.png', { animations: 'disabled', scale: 'css', maxDiffPixels: 0, threshold: 0 });
    verdict(info, 'fixture-css-scale.png', 'PASS', null);
    observed.push({ name: info.title, verdict: 'PASS', actualSha256: null, actualSource: 'native-success-does-not-publicly-return-buffer' });
  } finally { await context.close(); }
});

test('fixture direct Buffer is compared without a second screenshot', async ({ page }, info) => {
  await solid(page);
  const actual = await page.locator('#target').screenshot({ animations: 'disabled', scale: 'css' });
  expect(actual).toMatchSnapshot('fixture-buffer.png', { maxDiffPixels: 0, threshold: 0 });
  verdict(info, 'fixture-buffer.png', 'PASS', sha(actual));
  observed.push({ name: info.title, verdict: 'PASS', actualSha256: sha(actual), actualSource: 'same-buffer-passed-to-native-toMatchSnapshot' });
});

test('fixture stable wrong image remains a native failure', async ({ page }, info) => {
  await solid(page);
  await expectedFailure(info, 'fixture-wrong.png', 'stable-mismatch', () => expect(page.locator('#target')).toHaveScreenshot('fixture-wrong.png', { animations: 'disabled', maxDiffPixels: 0, threshold: 0 }));
});

test('fixture different image dimensions remain a native failure', async ({ page }, info) => {
  await solid(page);
  await expectedFailure(info, 'fixture-dimensions.png', 'dimensions-mismatch', () => expect(page.locator('#target')).toHaveScreenshot('fixture-dimensions.png', { animations: 'disabled', maxDiffPixels: 0, threshold: 0 }));
});

test('fixture screenshot timeout keeps actual explicitly unavailable', async ({ page }, info) => {
  await solid(page, '#target{visibility:hidden}');
  await expectedFailure(info, 'fixture-solid.png', 'timeout-no-actual', () => expect(page.locator('#target')).toHaveScreenshot('fixture-solid.png', { timeout: 250, animations: 'disabled', maxDiffPixels: 0, threshold: 0 }));
});

test('fixture a closed page remains a failure without invented actual', async ({ page }, info) => {
  await solid(page); const locator = page.locator('#target'); await page.close();
  await expectedFailure(info, 'fixture-solid.png', 'closed-page-no-actual', () => expect(locator).toHaveScreenshot('fixture-solid.png', { timeout: 250, animations: 'disabled', maxDiffPixels: 0, threshold: 0 }));
});
