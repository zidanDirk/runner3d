import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRelease } from './verify.mjs';
import { verifyRemoteRelease } from './remote-smoke.mjs';
import { createKodoClient } from './kodo-client.mjs';
import { prepareQiniuUpload, uploadQiniuCandidate, writeUploadCheckpoint } from './qiniu-upload.mjs';

/** Operator-only deployment command; never invoked by release:check. */
const mode = process.argv[2];
try {
  if (!['upload', 'promote'].includes(mode) || process.argv[3] !== '--execute') throw new Error('Explicit upload/promote --execute required; see docs/release.md');
  const resume = process.argv[4] === '--resume';
  if (process.argv.length > (resume ? 5 : 4) || (process.argv[4] && (!resume || mode !== 'upload'))) throw new Error('Only upload --execute [--resume] or promote --execute is supported');
  const base = new URL(process.env.RELEASE_BASE_URL ?? '');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base.pathname)) throw new Error('RELEASE_BASE_URL must be a trailing-slash HTTPS deployment root');
  const bucket = process.env.QINIU_BUCKET;
  if (!bucket || !/^[a-zA-Z0-9._-]+$/.test(bucket) || !process.env.QINIU_AK || !process.env.QINIU_SK) throw new Error('Configure QINIU_BUCKET and secret QINIU_AK/QINIU_SK in the protected environment');
  const report = await verifyRelease();
  const gate = JSON.parse(await readFile('artifacts/beta-release/gate/report.json', 'utf8'));
  if (gate.status !== 'passed' || gate.artifact?.manifestSha256 !== report.manifestSha256) throw new Error('Exact artifact has no successful release gate');
  const id = report.release.buildId;
  const prefix = base.pathname.slice(1);
  const candidate = new URL(`releases/${id}/`, base);
  const command = (args, quiet = false) => new Promise((resolve, reject) => {
    const child = spawn('qshell', args, { shell: false, stdio: quiet ? 'ignore' : 'inherit' });
    child.once('error', () => reject(new Error('Unable to execute qshell')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Qshell operation failed; check protected runner logs')));
  });
  const confirmation = resume ? `RESUME ${id} ${report.manifestSha256}` : `${mode.toUpperCase()} ${id}`;
  if (process.env.RELEASE_CONFIRM !== confirmation) throw new Error('RELEASE_CONFIRM must name the exact reviewed build and, for resume, original manifest hash');
  if (mode === 'upload') {
    if (process.env.RELEASE_ENV !== report.release.environment) throw new Error('RELEASE_ENV must match the reviewed artifact environment and protected job environment');
    if (report.release.environment !== 'preview') throw new Error('Production candidate uploads remain blocked pending real Preview deployment verification and separate review');
    const plan = await prepareQiniuUpload({ baseURL: base.href, bucket, report });
    const client = createKodoClient({ accessKey: process.env.QINIU_AK, secretKey: process.env.QINIU_SK, bucket });
    console.log(`Immutable ${resume ? 'resume' : 'upload'} plan: ${id}; ${plan.files.length} files; manifest ${plan.manifestSha256}. Receipt: artifacts/beta-release/uploads/${id}.json`);
    const result = await uploadQiniuCandidate(plan, client, { resume, checkpoint: writeUploadCheckpoint });
    console.log(`Candidate ${result.status}: ${candidate.href}. Active entry was not changed. HTTPS and browser smoke still required.`);
  } else {
    if (report.release.environment !== 'production') throw new Error('Only production artifacts can be promoted');
    if (process.env.RELEASE_APPROVAL_CONFIGURED !== 'true') throw new Error('Configure production required-reviewer approval and confirm RELEASE_APPROVAL_CONFIGURED');
    const previous = process.env.RELEASE_PREVIOUS_BUILD;
    if (!previous || !/^(?:none|[A-Za-z0-9][A-Za-z0-9._-]{0,119})$/.test(previous)) throw new Error('Record RELEASE_PREVIOUS_BUILD (or none for first launch)');
    await verifyRemoteRelease(candidate.href, id);
    const temporary = await mkdtemp(join(tmpdir(), 'runner3d-promotion-'));
    try {
      const launcher = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./releases/${id}/"><title>Runner3D Beta</title><p>正在打开 Runner3D ${report.release.version}… <a href="./releases/${id}/">进入游戏</a></p></html>\n`;
      const history = { schemaVersion: 1, promotedAt: new Date().toISOString(), previousBuildId: previous, buildId: id, manifestSha256: report.manifestSha256 };
      await writeFile(join(temporary, 'index.html'), launcher);
      await writeFile(join(temporary, 'promotion.json'), JSON.stringify(history, null, 2) + '\n');
      await writeFile(join(temporary, 'refresh.txt'), new URL('index.html', base).href + '\n');
      await command(['account', '--', process.env.QINIU_AK, process.env.QINIU_SK, 'runner3d-ci'], true);
      await command(['fput', bucket, `${prefix}promotions/${Date.now()}-${id}.json`, join(temporary, 'promotion.json'), '--mimetype=application/json']);
      await command(['fput', bucket, `${prefix}index.html`, join(temporary, 'index.html'), '--overwrite', '--mimetype=text/html']);
      await command(['cdnrefresh', '-i', join(temporary, 'refresh.txt')]);
      console.log('Stable entry promotion submitted. CDN refresh is asynchronous; verify active entry and keep the previous release.');
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
} catch (error) { console.error(`[release:qiniu] ${error instanceof Error ? error.message : 'Deployment failed'}`); process.exitCode = 1; }
