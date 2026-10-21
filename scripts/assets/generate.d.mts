import type { GeneratedManifest } from './validate.mjs';
export function runProcess(executable: string, args: string[], options: { timeout: number; capture?: boolean }): Promise<string>;
export function verifyBlenderVersion(output: string): string;
export function generationLayout(staging: string): { jobPath: string; output: string; reportPath: string };
export function publishGeneration(files: { source: string; target: string }[], manifest: unknown, staging: string, manifestPath?: string): Promise<void>;
export function generateAssets(options?: { configPath?: string; only?: string; log?: (message: string) => void }): Promise<GeneratedManifest>;
