import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPROVED_PROPOSAL_SHA256 = '7cbb10e363cce6a62f1f73bbb4252c478a6c76c3647d2e456867d79674958c21';
const proposalPath = 'artifacts/beta-launch/platform-reference-proposal.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (ok, message) => { if (!ok) throw new Error(message); };

function realFile(root, path) {
  let current = root;
  for (const part of path.split('/')) {
    check(part && part !== '.' && part !== '..', 'Invalid reference path');
    current = join(current, part);
    check(!lstatSync(current).isSymbolicLink(), `Reference symlink forbidden: ${path}`);
  }
  const stat = lstatSync(current);
  check(stat.isFile() && stat.size > 0 && stat.size <= 10 * 1024 * 1024, `Invalid reference file: ${path}`);
  return readFileSync(current);
}

function dimensions(bytes) {
  check(bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR', 'Invalid reference PNG header');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  check(width > 0 && height > 0 && width <= 8192 && height <= 8192, 'Invalid reference PNG dimensions');
  return { width, height };
}

/** Read-only exact byte verification. There is deliberately no update command. */
export function validateVisualReferences(root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')) {
  const raw = realFile(root, proposalPath);
  check(digest(raw) === APPROVED_PROPOSAL_SHA256, 'Approved proposal hash changed; manual review required');
  const proposal = JSON.parse(raw.toString('utf8'));
  check(proposal.schemaVersion === 1 && proposal.entries.length === 91, 'Expected the 91 approved reference pairs');
  const entries = [], expected = new Set(), expectedDirectories = new Set(); let reviewed = 0, copied = 0;
  for (const row of proposal.entries) {
    check(/^tests\/e2e\/[a-z0-9-]+\.spec\.ts-snapshots\/[a-z0-9-]+\.png$/.test(row.original), 'Invalid original reference path');
    const filename = row.original.split('/').at(-1);
    check(row.proposed === `${row.original.slice(0, -filename.length)}github-macos-26/${filename}`, 'Invalid platform reference path');
    check(!expected.has(row.original) && !expected.has(row.proposed), 'Duplicate reference path');
    expected.add(row.original); expected.add(row.proposed);
    for (const path of [row.original, row.proposed]) {
      let parent = dirname(path);
      while (parent !== 'tests/e2e') { expectedDirectories.add(parent); parent = dirname(parent); }
    }
    const original = realFile(root, row.original), platform = realFile(root, row.proposed);
    const originalSha256 = digest(original), platformSha256 = digest(platform);
    check(originalSha256 === row.originalSha256, `Original reference hash mismatch: ${row.original}`);
    check(platformSha256 === row.proposedSha256, `Platform reference hash mismatch: ${row.proposed}`);
    const size = dimensions(original), platformSize = dimensions(platform);
    check(size.width === platformSize.width && size.height === platformSize.height, `Reference dimensions changed: ${filename}`);
    if (row.sourceKind === 'reviewed-ci-actual') {
      reviewed++; check(row.reviewEvidence.actualSha256 === platformSha256, 'Actual source hash mismatch');
    } else {
      check(row.sourceKind === 'unchanged-original-copy' && originalSha256 === platformSha256, 'Copy source mismatch'); copied++;
    }
    entries.push({ original: row.original, platform: row.proposed, originalSha256, platformSha256, sourceKind: row.sourceKind, ...size, matched: true });
  }
  check(reviewed === 35 && copied === 56, 'Expected exactly 35 reviewed actuals and 56 unchanged copies');
  const found = [];
  const walk = directory => {
    check(expectedDirectories.has(directory), `Unexpected reference directory: ${directory}`);
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      check(!entry.isSymbolicLink(), `Reference symlink forbidden: ${path}`);
      if (entry.isDirectory()) walk(path);
      else { check(expected.has(path), `Unexpected reference file: ${path}`); found.push(path); }
    }
  };
  for (const entry of readdirSync(join(root, 'tests/e2e'), { withFileTypes: true })) {
    if (!entry.name.endsWith('-snapshots')) continue;
    check(entry.isDirectory() && !entry.isSymbolicLink(), `Reference directory/symlink forbidden: ${entry.name}`);
    walk(`tests/e2e/${entry.name}`);
  }
  check(found.length === 182 && found.every(path => expected.has(path)), 'Unexpected or missing reference PNG; manual inventory review required');
  return { schemaVersion: 1, proposalSha256: digest(raw), sourceCommit: proposal.sourceCommit, sourceRun: proposal.sourceRun, originalCount: 91, platformCount: 91, reviewedActualCount: reviewed, unchangedCopyCount: copied, allMatched: true, entries };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { console.log(JSON.stringify(validateVisualReferences(), null, 2)); }
  catch (error) { console.error(`[visual:validate] ${error.message}`); process.exitCode = 1; }
}
