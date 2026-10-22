import { spawn } from 'node:child_process';
import { safeEnv } from './security';
import type { Runner } from './types';

/** No shell interpolation; bounded output, wall time and process-group lifetime. */
export const runProcess: Runner = (command, args, options) => new Promise(resolve => {
  const start = Date.now(), cap = options.maxBytes ?? 262144;
  let stdout = '', stderr = '', bytes = 0, reason: string | undefined, done = false;
  const child = spawn(command, [...args], { cwd: options.cwd, env: options.env ?? safeEnv(), shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals): void => {
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ }
  };
  const stop = (why: string): void => { if (reason) return; reason = why; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 500); };
  const timer = setTimeout(() => stop('TIMEOUT'), options.timeoutMs ?? 180000);
  const interrupted = (): void => stop('CANCELLED');
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  const collect = (data: Buffer, target: 'out' | 'err'): void => {
    const remaining = Math.max(0, cap - bytes); bytes += data.length;
    const chunk = data.subarray(0, remaining).toString('utf8');
    if (target === 'out') stdout += chunk; else stderr += chunk;
    if (bytes > cap) stop('OUTPUT_LIMIT');
  };
  child.stdout.on('data', (data: Buffer) => collect(data, 'out')); child.stderr.on('data', (data: Buffer) => collect(data, 'err'));
  const finish = (code: number): void => {
    if (done) return; done = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    kill('SIGKILL'); // Retire remaining members of this command's own process group.
    resolve({ exitCode: reason ? 1 : code, stdout, stderr, durationMs: Date.now() - start, ...(reason ? { reason } : {}) });
  };
  child.once('error', () => { reason = 'SPAWN_FAILED'; finish(1); }); child.once('close', code => finish(code ?? 1));
  child.stdin.on('error', () => { /* Child exited before consuming all input. */ }); child.stdin.end(options.input ?? '');
});
