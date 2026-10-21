import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverBlender } from './find-blender.mjs';
import { PROJECT_ROOT, GENERATED_MANIFEST, BLENDER_VERSION, GENERATOR_VERSION, readConfig, createJob, assetContract, selectAssets, selectedTheme, parseCli } from './config.mjs';
import { assertEntryCurrent, assertEntryMatches, createGeneratedManifest, createManifestEntry, readGeneratedManifest, validateAsset, validateManifestShape } from './validate.mjs';

export function runProcess(executable, args, { timeout, capture = false }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd: PROJECT_ROOT, shell: false, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    let output = '';
    let timedOut = false;
    let forceKill;
    if (capture) {
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.stderr.on('data', (data) => { output += data.toString(); });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 2000);
      forceKill.unref();
    }, timeout);
    timer.unref();
    child.on('error', (error) => {
      clearTimeout(timer);
      clearTimeout(forceKill);
      reject(new Error(`无法启动 Blender：${error.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceKill);
      if (timedOut) reject(new Error(`Blender 超过 ${timeout / 1000} 秒，已终止；目标资源未更新`));
      else if (code !== 0) reject(new Error(`Blender 执行失败 (exit=${code ?? 'null'}, signal=${signal ?? 'none'})${capture ? `\n${output.trim()}` : ''}；目标资源未更新`));
      else resolveRun(output);
    });
  });
}
export function verifyBlenderVersion(output) {
  const version = /^Blender (\d+\.\d+\.\d+)(?:\s|$)/m.exec(output)?.[1];
  if (version !== BLENDER_VERSION) throw new Error(`Blender 版本不一致：实际 ${version ?? '未识别'}，要求 ${BLENDER_VERSION}；请配置 BLENDER_PATH，禁止跨版本静默生成`);
  return version;
}
export function generationLayout(staging) {
  const output = join(staging, 'output');
  return { jobPath: join(staging, 'job.json'), output, reportPath: join(output, 'report.json') };
}

/** Publish validated files first and manifest last; roll back every replaced file on failure. */
export async function publishGeneration(files, manifest, staging, manifestPath = GENERATED_MANIFEST) {
  const completed = [];
  try {
    for (const [i, file] of files.entries()) {
      const backup = join(staging, `backup-${i}.glb`);
      let existed = false;
      try { await rename(file.target, backup); existed = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const operation = { ...file, backup, existed };
      completed.push(operation);
      await rename(file.source, file.target);
    }
    const temporaryManifest = join(staging, 'manifest.next.json');
    await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await mkdir(resolve(manifestPath, '..'), { recursive: true });
    await rename(temporaryManifest, manifestPath);
  } catch (error) {
    const failures = [];
    for (const operation of completed.reverse()) {
      try {
        await rm(operation.target, { force: true });
        if (operation.existed) await rename(operation.backup, operation.target);
      } catch (rollbackError) { failures.push(rollbackError.message); }
    }
    if (failures.length) throw Object.assign(new Error(`发布失败：${error.message}；回滚失败：${failures.join('; ')}；恢复备份保留在 ${staging}`), { preserveStaging: true });
    throw error;
  }
}

export async function generateAssets({ configPath, only, log = console.log } = {}) {
  const { config, theme, themes } = await readConfig(configPath);
  const selected = selectAssets(config, only);
  const job = createJob(config, theme, only, themes);
  const directory = resolve(PROJECT_ROOT, 'public/models/generated');
  await mkdir(directory, { recursive: true });
  const lock = join(directory, '.asset-generation.lock');
  try { await mkdir(lock); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`另一个资产生成任务持有锁：${lock}。确认没有 Blender 生成进程后才能删除此锁重试。`); throw error; }
  let staging;
  let preserveStaging = false;
  try {
    const entries = {};
    if (only !== undefined) {
      let previous;
      try { previous = validateManifestShape(await readGeneratedManifest(), config, theme, { allowStaleRoot: true, themes }); }
      catch (error) { throw new Error(`--only 需要其余已生成资源有效：${error.message}；请先全量 npm run assets:generate`); }
      for (const asset of config.assets) {
        if (asset.id === only) continue;
        const entry = previous.assets[asset.id];
        const palette = selectedTheme(asset, config, themes);
        assertEntryCurrent(entry, asset, config, palette);
        const result = await validateAsset({ manifest: assetContract(asset, config.seed), theme: palette });
        assertEntryMatches(entry, createManifestEntry(asset, config, palette, result), asset.id);
        entries[asset.id] = entry;
      }
      log(`[范围] 仅生成 ${only}；${config.assets.length - 1} 个其余资源已验证且保持原文件`);
    } else log(`[范围] 批量生成 ${selected.length} 个资源，单次 Blender 后台进程`);
    const blender = discoverBlender();
    log(`[Blender] 可执行文件：${blender}`);
    const version = await runProcess(blender, ['--version'], { timeout: 15000, capture: true });
    log(`[Blender] ${verifyBlenderVersion(version)}（配置严格锁定版本）`);
    staging = await mkdtemp(join(directory, '.asset-job-'));
    const { jobPath, output, reportPath } = generationLayout(staging);
    await writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`, { flag: 'wx' });
    const script = fileURLToPath(new URL('../blender/generate.py', import.meta.url));
    await runProcess(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', '--job', jobPath, '--output-dir', output], { timeout: 180000 });
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (report.blenderVersion !== BLENDER_VERSION || report.generatorVersion !== GENERATOR_VERSION) throw new Error('Blender report 版本不一致；目标资源未更新');
    if (!report.assets || Object.keys(report.assets).length !== selected.length || !selected.every((asset) => Object.hasOwn(report.assets, asset.id))) throw new Error('Blender report 资源列表与此次生成范围不一致；目标资源未更新');
    const files = [];
    for (const asset of selected) {
      const source = join(output, `${asset.id}.glb`);
      const contract = assetContract(asset, config.seed);
      const palette = selectedTheme(asset, config, themes);
      const result = await validateAsset({ filePath: source, manifest: contract, theme: palette, log });
      entries[asset.id] = createManifestEntry(asset, config, palette, result);
      files.push({ source, target: resolve(PROJECT_ROOT, contract.path) });
    }
    // Stable config ordering keeps output byte-for-byte reproducible after --only runs too.
    const orderedEntries = Object.fromEntries(config.assets.map((asset) => [asset.id, entries[asset.id]]));
    const manifest = createGeneratedManifest(config, theme, orderedEntries, themes);
    validateManifestShape(manifest, config, theme, { themes });
    await publishGeneration(files, manifest, staging);
    for (const asset of selected) log(`[完成] ${asset.id}: ${entries[asset.id].triangles} 三角形，${entries[asset.id].bytes} bytes，sha256=${entries[asset.id].sha256}`);
    log(`[Manifest] 已根据实际 GLB + Three.js 统计发布：${GENERATED_MANIFEST}`);
    return manifest;
  } catch (error) {
    preserveStaging = error.preserveStaging === true;
    throw error;
  } finally {
    if (staging && !preserveStaging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = parseCli(process.argv.slice(2), { only: true });
    await generateAssets({ configPath: args.config, only: args.only });
  } catch (error) { console.error(`[资源生成失败] ${error.message}`); process.exitCode = 1; }
}
