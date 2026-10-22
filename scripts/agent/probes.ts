import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { safeEnv } from './security';
import { sandboxedQA } from './sandbox';
import { check } from './types';
import type { Runner } from './types';
import type { Store } from './store';

/** Fixed trusted canary program, not model-authored instructions. Never reads an actual secret. */
export async function sandboxProbe(root: string, store: Store, runner: Runner): Promise<unknown> {
  const work = resolve(store.root, 'worktrees', 'sandbox-probe'); await mkdir(work, { recursive: true }); check(!(await lstat(work)).isSymbolicLink(), 'Probe directory symlink forbidden');
  const canary = resolve(store.root, 'reports', `sandbox-canary-${randomUUID()}.txt`);
  await writeFile(canary, 'unchanged', { flag: 'wx', mode: 0o600 });
  const code = `const fs=require('node:fs'),http=require('node:http'),net=require('node:net');
(async()=>{let readDenied=false,writeDenied=false;try{fs.readFileSync(process.argv[1]);}catch{readDenied=true;}try{fs.writeFileSync(process.argv[1],'changed');}catch{writeDenied=true;}fs.writeFileSync('local-write.txt','allowed');
const server=http.createServer((req,res)=>res.end('ok'));await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});const address=server.address();const localOK=(await(await fetch('http://127.0.0.1:'+address.port)).text())==='ok';await new Promise(r=>server.close(r));
const externalCode=await new Promise(r=>{const socket=net.connect({host:'198.51.100.1',port:443});socket.setTimeout(800,()=>{socket.destroy();r('TIMEOUT')});socket.on('error',e=>r(e.code));socket.on('connect',()=>{socket.destroy();r('CONNECTED')})});
const result={ownWrite:true,readDenied,writeDenied,localOK,externalCode,credentialsAbsent:!process.env.GH_TOKEN};console.log(JSON.stringify(result));if(!readDenied||!writeDenied||!localOK||!['EPERM','EACCES'].includes(externalCode)||!result.credentialsAbsent)process.exitCode=1;
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1});`;
  try {
    const qa = sandboxedQA(runner, root);
    const result = await qa(process.execPath, ['-e', code, canary], { cwd: work, timeoutMs: 15000, env: { ...safeEnv(), GH_TOKEN: 'synthetic-canary-not-a-credential' } });
    const npm = await qa(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { cwd: work, timeoutMs: 15000 });
    const report = { at: new Date().toISOString(), result, npm, privateFileUnchanged: await readFile(canary, 'utf8') === 'unchanged' };
    await store.write('reports/qa-sandbox-probe.json', report); check(result.exitCode === 0 && npm.exitCode === 0 && report.privateFileUnchanged, 'QA_SANDBOX_PROBE_FAILED'); return report;
  } finally { await rm(canary, { force: true }); }
}
