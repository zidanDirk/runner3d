export function verifyRemoteRelease(address: string, expectedId: string, options?: {
  fetcher?: (url: URL, options: RequestInit) => Promise<Response>;
  manifestBytes?: Uint8Array;
}): Promise<{ verifiedAt: string; buildId: string; files: number; https: boolean; manifestSha256: string; scope: string }>;
