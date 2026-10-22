import type { ReleaseInfo } from '../../src/release/config';
export function verifyRelease(directory?: string): Promise<{ release: ReleaseInfo; fileCount: number; bytes: number; glbs: number; manifestSha256: string }>;
